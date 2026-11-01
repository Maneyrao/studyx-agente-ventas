import type { CourseBonusLadderV1 } from './bonus-ladder';
import { courseBonusLadderRejectionSubjectsV1 } from './bonus-ladder-rejection';

export const COURSE_MENTION_ROLES_V1 = ['paid', 'bonus', 'paid_complement', 'alternative'] as const;
export interface CourseMentionV1 {
  readonly offering_code: string;
  readonly role: typeof COURSE_MENTION_ROLES_V1[number];
}
export interface CourseMentionViolationV1 {
  readonly code: 'COURSE_ROLE_UNDECLARED' | 'FACT_VALUE_MISMATCH';
  readonly subject: string;
}

function wordCharacter(value: string | undefined): boolean {
  return value !== undefined && (value.toLocaleLowerCase('es') !== value.toLocaleUpperCase('es')
    || (value >= '0' && value <= '9') || value === '_');
}

/** Wire identifier only; this never changes the model's text or course identity. */
function rejectionSubject(value: string): string {
  return Array.from(value, character => (
    (character>='a' && character<='z') || (character>='A' && character<='Z')
      || (character>='0' && character<='9') || '_:.-'.includes(character)
      ? character : '_'
  )).join('').slice(0,160);
}

/** Literal catalog identities only. No interpretation of commercial wording or role inference. */
export function validateCourseMentionsV1(input: {
  readonly messages: readonly string[];
  readonly call_offer?: string | null;
  readonly catalog: readonly { readonly code: string; readonly display_name: string }[];
  readonly course_mentions?: readonly CourseMentionV1[];
  readonly paid_offering_code: string | null;
  /** Server-derived dialogue focus; never purchase, package or bonus authority. */
  readonly paid_mention_offering_code?: string | null;
  readonly authorized_bonus_action?: { readonly paid_offering_code: string; readonly bonus_offering_code: string };
  readonly delivered_bonus_offering_codes: readonly string[];
  readonly ladder?: CourseBonusLadderV1;
}): { readonly violations: readonly CourseMentionViolationV1[]; readonly named_offering_codes: readonly string[] } {
  const violations: CourseMentionViolationV1[] = [];
  const reject = (rawSubject: string, code: CourseMentionViolationV1['code'] = 'COURSE_ROLE_UNDECLARED') => {
    const subject=rejectionSubject(rawSubject);
    if (!violations.some(v => v.subject === subject && v.code === code)) violations.push({ code, subject });
  };
  const catalogCodes = new Set(input.catalog.map(course => course.code));
  const paidMentionCode = input.paid_offering_code
    ?? (input.paid_mention_offering_code && catalogCodes.has(input.paid_mention_offering_code)
      ? input.paid_mention_offering_code : null);
  const names = new Map<string, Set<string>>();
  for (const course of input.catalog) {
    const name=course.display_name;
    if (!name.trim()) continue;
    const codes=names.get(name) ?? new Set<string>();codes.add(course.code);names.set(name,codes);
  }
  const named = new Set<string>();
  for (const message of [...input.messages, ...(input.call_offer ? [input.call_offer] : [])]) {
    const text=message;
    const matches:Array<{start:number;end:number;codes:readonly string[]}> = [];
    for (const [name,codes] of names) {
      let from=0;
      while (from<text.length) {
        const start=text.indexOf(name,from);if(start<0) break;
        const end=start+name.length;from=start+1;
        if (!wordCharacter(text[start-1]) && !wordCharacter(text[end])) matches.push({start,end,codes:[...codes]});
      }
    }
    const selected:typeof matches=[];
    for (const match of matches.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start)) {
      if (!selected.some(other=>match.start<other.end && other.start<match.end)) selected.push(match);
    }
    for (const match of selected.sort((a,b)=>a.start-b.start)) {
      if (match.codes.length!==1) for(const code of match.codes) reject(`course_mentions:ambiguous:${code}`);
      for(const code of match.codes) named.add(code);
    }
  }
  const declared=new Map<string,CourseMentionV1>();
  for(const mention of input.course_mentions ?? []) {
    if (declared.has(mention.offering_code)) reject(`course_mentions:duplicate:${mention.offering_code}`);
    const authoritativeIdentity = mention.role==='paid' && mention.offering_code===input.paid_offering_code
      || mention.role==='bonus' && mention.offering_code!==input.paid_offering_code
        && input.delivered_bonus_offering_codes.includes(mention.offering_code);
    if (!catalogCodes.has(mention.offering_code) && !authoritativeIdentity) reject(`course_mentions:unknown:${mention.offering_code}`);
    if (!COURSE_MENTION_ROLES_V1.some(role=>role===mention.role)) reject(`course_mentions:unknown_role:${mention.offering_code}`);
    if (mention.role==='paid' && mention.offering_code!==paidMentionCode) reject(`course_mentions:paid_mismatch:${mention.offering_code}`);
    declared.set(mention.offering_code,mention);
  }
  for(const code of named) {
    if (!declared.has(code) && code!==paidMentionCode) reject(`course_mentions:undeclared:${code}`);
  }
  const effectDeclaration=input.authorized_bonus_action
    ? declared.get(input.authorized_bonus_action.bonus_offering_code) : undefined;
  if (effectDeclaration && effectDeclaration.role!=='bonus') reject('forbidden_promise','FACT_VALUE_MISMATCH');
  for(const mention of declared.values()) {
    if (mention.role!=='bonus') continue;
    const prospective=mention.offering_code!==input.paid_offering_code
      && input.authorized_bonus_action?.paid_offering_code===input.paid_offering_code
      && input.authorized_bonus_action?.bonus_offering_code===mention.offering_code;
    const delivered=mention.offering_code!==input.paid_offering_code
      && input.delivered_bonus_offering_codes.includes(mention.offering_code);
    if (!prospective && !delivered) {
      const subjects=input.ladder?.eligible===false ? courseBonusLadderRejectionSubjectsV1(input.ladder) : ['forbidden_promise'];
      for(const subject of subjects) reject(subject,'FACT_VALUE_MISMATCH');
    }
  }
  return { violations, named_offering_codes:[...named] };
}
