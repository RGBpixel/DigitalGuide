import type { FastifyInstance,FastifyRequest } from 'fastify';
import type { Repository } from '@digitalguide/database';
import { id,diningServiceInput,diningServiceActionInput,feedbackInput,followupConsentInput,aftercareRevokeInput } from '@digitalguide/contracts';
import type { Config } from './config.js';
import type { DiningActor,PartyRow } from './dining-service.js';
import { DiningHospitalityService,type ServiceRow } from './dining-hospitality.js';
import { restaurantActionContext,type RestaurantActionHelpers } from './restaurant-action-context.js';
export function registerDiningHospitalityRoutes(app:FastifyInstance,repo:Repository,config:Config,helpers:RestaurantActionHelpers){
 const s=new DiningHospitalityService(repo,config),http=restaurantActionContext(repo,config,helpers),param=(req:FastifyRequest,key='id')=>id.parse((req.params as Record<string,string>)[key]);
 for(const guest of [false,true]){
  const base=guest?'/api/v1/guest/sessions/:id/dining':'/api/v1/restaurant';
  app.get(base+'/parties/:partyId/services',(req,reply)=>http.read(req,reply,guest,a=>{const p=s.dining.party(a,param(req,'partyId'));return repo.all<ServiceRow>('SELECT * FROM dining_service_requests WHERE party_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100',p.id).map(r=>s.view(a,r));}));
  app.post(base+'/parties/:partyId/services',(req,reply)=>{const input=diningServiceInput.parse(req.body),guard=(a:DiningActor)=>s.dining.party(a,param(req,'partyId'));return http.write(req,reply,guest,input.focusVersion,guard,a=>{const p=guard(a);return {id:s.create(a,p.id,input),restaurantId:p.restaurant_id};},(a,ref)=>s.view(a,s.request(a,ref.id)));});
  app.post(base+'/services/:requestId/actions',(req,reply)=>{const input=diningServiceActionInput.parse(req.body),guard=(a:DiningActor)=>s.request(a,param(req,'requestId'));return http.write(req,reply,guest,input.focusVersion,guard,a=>{const r=guard(a);s.action(a,r,input);return {id:r.id,restaurantId:r.restaurant_id};},(a,ref)=>s.view(a,s.request(a,ref.id)));});
  app.get(base+'/parties/:partyId/aftercare',(req,reply)=>http.read(req,reply,guest,a=>s.aftercare(a,param(req,'partyId'))));
 }
 app.get('/api/v1/restaurants/:id/services',(req,reply)=>http.read(req,reply,false,a=>{const r=s.core.row(a.p,param(req));return repo.all<ServiceRow>('SELECT * FROM dining_service_requests WHERE restaurant_id=? ORDER BY CASE status WHEN \'requested\' THEN 0 WHEN \'acknowledged\' THEN 1 ELSE 2 END,created_at DESC,rowid DESC LIMIT 200',r.id).map(q=>s.view(a,q));}));
 app.get('/api/v1/restaurants/:id/aftercare',(req,reply)=>http.read(req,reply,false,a=>{const r=s.core.row(a.p,param(req));return repo.all<PartyRow>("SELECT * FROM dining_parties WHERE restaurant_id=? AND status='completed' ORDER BY ended_at DESC,id DESC LIMIT 100",r.id).map(p=>({partyName:p.name,...s.aftercare(a,p.id)}));}));
 const base='/api/v1/guest/sessions/:id/dining/parties/:partyId';
 for(const action of ['feedback','followup','feedback/revoke','followup/revoke'] as const)app.post(base+'/'+action,(req,reply)=>{const schema=action==='feedback'?feedbackInput:action==='followup'?followupConsentInput:aftercareRevokeInput,input=schema.parse(req.body),guard=(a:DiningActor)=>s.dining.party(a,param(req,'partyId'));return http.write(req,reply,true,input.focusVersion,guard,a=>{const p=guard(a);if(action==='feedback')s.feedback(a,p.id,input);else if(action==='followup')s.consent(a,p.id,input);else s.revoke(a,p.id,input.version,action.startsWith('feedback')?'feedback':'followup');return {id:p.id,restaurantId:p.restaurant_id};},(a,ref)=>s.aftercare(a,ref.id));});
}
