import { describe, expect, it } from 'vitest';
import { activeSessionRecentTurnsV1, deriveConversationCourseFocusV1, type CourseFocusTurnV1 } from '@/features/orchestration/domain/course-focus';
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
