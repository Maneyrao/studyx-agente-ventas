import { describe, expect, it } from 'vitest';
import { activeSessionRecentTurnsV1, currentFactualCourseReferencesV1, deriveConversationCourseFocusV1, type CourseFocusTurnV1 } from '@/features/orchestration/domain/course-focus';
import type { CatalogIndexView } from '@/features/orchestration/domain/business-context';

const catalog:CatalogIndexView={as_of:'2026-11-01T12:00:00.000Z',offerings_total:3,injection_suspected_count:0,offerings:[
  {code:'fotografia_profesional',display_name:'Fotografía Profesional',academy:'Fotografía',aliases:[]},
  {code:'fotografia_celulares',display_name:'Fotografía con Celulares',academy:'Fotografía',aliases:[]},
  {code:'marketing_digital',display_name:'Marketing Digital',academy:'Marketing',aliases:[]},
]};
const old=[{direction:'inbound' as const,content:'Quiero información de Marketing Digital.'}];
const focus=(current:string,history:readonly CourseFocusTurnV1[]=old,index:CatalogIndexView|null=catalog)=>deriveConversationCourseFocusV1({
  currentMessageTexts:[current],recentTurns:history,catalogIndex:index,
});
describe('server dialogue course focus shared by claim and paid mention validation',()=>{
  it('lets the current exact course outrank recent history without writing a selection',()=>{
    expect(focus('Quiero Fotografía Profesional.')).toEqual({offering_code:'fotografia_profesional',course_of_interest:'Fotografía Profesional'});
  });
  it('retains an exact historical subject for a neutral follow-up',()=>{
    expect(focus('Cuánto dura?')).toEqual({offering_code:'marketing_digital',course_of_interest:'Marketing Digital'});
  });
  it('never revives the old subject after a newer ambiguous inquiry',()=>{
    expect(focus('Cuánto dura?',[...old,{direction:'inbound',content:'Quiero un curso de fotografía.'}])).toEqual({offering_code:null,course_of_interest:null});
    expect(focus('Quiero un curso de fotografía.')).toEqual({offering_code:null,course_of_interest:null});
  });
  it('never revives a course from unavailable or truncated canonical data',()=>{
    expect(focus('Cuánto dura?',old,null)).toEqual({offering_code:null,course_of_interest:null});
    expect(focus('Curso de fotografía',old,{...catalog,offerings_total:4,offerings:[catalog.offerings[0]!]})).toEqual({offering_code:null,course_of_interest:null});
  });
  it('does not retain a historical subject across nonneutral conversation changes',()=>{
    expect(focus('No quiero fotografía.')).toEqual({offering_code:null,course_of_interest:null});
  });
  it('uses only the active session suffix and discards future conversation rows',()=>{
    const scoped=activeSessionRecentTurnsV1([
      {...old[0]!,created_at:'2026-11-01T09:00:00.000Z'},
      {direction:'inbound',content:'Cuánto dura?',created_at:'2026-11-01T11:59:00.000Z'},
      {direction:'inbound',content:'Quiero Fotografía Profesional.',created_at:'2026-11-01T12:01:00.000Z'},
    ],[{created_at:'2026-11-01T12:00:00.000Z'}],30*60*1000);
    expect(scoped).toEqual([{direction:'inbound',content:'Cuánto dura?',created_at:'2026-11-01T11:59:00.000Z'}]);
    expect(focus('Cuánto dura?',scoped)).toEqual({offering_code:null,course_of_interest:null});
  });
});


const factualCatalog: CatalogIndexView = { as_of: '2026-11-02T13:00:00.000Z', offerings_total: 4, injection_suspected_count: 0,
  offerings: [
    { code: 'introduccion_ecommerce', display_name: 'Introducción al Ecommerce', academy: 'Marketing', aliases: ['tienda web'] },
    { code: 'community_manager', display_name: 'Community Manager', academy: 'Marketing', aliases: ['redes sociales'] },
    { code: 'publicidad_redes_sociales', display_name: 'Publicidad en Redes Sociales', academy: 'Marketing', aliases: ['redes sociales'] },
    { code: 'marketing_digital', display_name: 'Marketing Digital', academy: 'Marketing', aliases: [] },
  ] };
describe('current explicit factual references from the complete active catalog', () => {
  it.each(['Ecommerce me gusta', 'Introducción al Ecommerce me gusta', 'introduccion_ecommerce me gusta', 'tienda web me gusta'])(
    'retrieves the named course even when the assistant did not name it: %s', text => {
      expect(currentFactualCourseReferencesV1([text], factualCatalog, ['Tenemos Marketing Digital y Publicidad en Redes Sociales.']))
        .toEqual([expect.objectContaining({ offeringCode: 'introduccion_ecommerce', source: 'current_customer_named_course' })]);
      expect(focus(text, [], factualCatalog).offering_code).toBe('introduccion_ecommerce');
    });
  it('keeps the customer order for two positive names and does not create a purchase selection', () => {
    expect(currentFactualCourseReferencesV1(['Community y ecommerce me gustan'], factualCatalog, []))
      .toEqual([expect.objectContaining({ offeringCode: 'community_manager' }), expect.objectContaining({ offeringCode: 'introduccion_ecommerce' })]);
    expect(focus('Community y ecommerce me gustan', [], factualCatalog).offering_code).toBeNull();
  });
  it.each(['no me gusta ecommerce', 'nada de ecommerce', 'ecommerce no', 'introducción me gusta', 'curso me gusta', 'redes sociales me gusta', 'marketing me gusta'])(
    'does not turn a negation, generic fragment or homonymous alias into one factual course: %s', text => {
      expect(currentFactualCourseReferencesV1([text], factualCatalog, [])).toEqual([]);
    });
  it('excludes a rejected course while preserving a distinct positive named course', () => {
    expect(currentFactualCourseReferencesV1(['ecommerce no, prefiero Community'], factualCatalog, []))
      .toEqual([expect.objectContaining({ offeringCode: 'community_manager' })]);
  });
  it.each([{ prior: [] }, { prior: ['Tenemos Introducción al Ecommerce y Community Manager.'] }])(
    'does not revive a subterm of a negated full course name, including prior-menu references: $prior', ({ prior }) => {
      expect(currentFactualCourseReferencesV1(['no quiero estudiar Introducción al Ecommerce'], factualCatalog, prior)).toEqual([]);
      expect(currentFactualCourseReferencesV1(['no quiero estudiar Introducción al Ecommerce y Community me gusta'], factualCatalog, prior))
        .toEqual([expect.objectContaining({ offeringCode: 'community_manager' })]);
    });
  it('fails closed when the canonical index is missing or truncated', () => {
    expect(currentFactualCourseReferencesV1(['ecommerce me gusta'], null, [])).toEqual([]);
    expect(currentFactualCourseReferencesV1(['ecommerce me gusta'], { ...factualCatalog, offerings_total: 5 }, [])).toEqual([]);
  });
});
