import {z} from 'zod';
import {kitchenRestaurantSchema,kitchenTicketSchema,type KitchenTicket} from '../../contracts/src/index.js';
import {AppError,type Principal} from '../../domain/src/index.js';
import {NativeOrders} from './runtime-orders.js';
export type NativeKitchenMode='read'|'cook'|'serve';
export class NativeKitchen extends NativeOrders {
 override async call<T>(name:string,args:unknown[]=[]):Promise<T>{try{return await super.call<T>(name,args);}catch(error){if(error instanceof AppError&&error.code==='NOT_FOUND')throw new AppError('NOT_FOUND','制作单或门店不存在，或当前账号没有对应的后厨/上菜职责。请联系经理核对。',404);throw error;}}
 kitchenContext(kind:'restaurant'|'ticket',id:string,write=false,mode:NativeKitchenMode='read'){return this.call<{workspaceId:string;restaurantId:string;canCook:boolean;canServe:boolean}>('dg_native_order_kitchen_context',[kind,id,write,mode]);}
 async prepareKitchen(p:Principal,kind:'restaurant'|'ticket',id:string,write=false,mode:NativeKitchenMode='read'){const meta=await this.kitchenContext(kind,id,write,mode);await this.core.workspaceLock(p,meta.workspaceId,write);return meta;}
 async directory(){return z.array(kitchenRestaurantSchema).parse(await this.call<unknown>('dg_native_order_kitchen_directory'));}
 async tickets(id:string){return z.array(kitchenTicketSchema).parse(await this.call<unknown>('dg_native_order_kitchen_read',[id]));}
 applyKitchen(id:string,input:Record<string,unknown>){return this.call<string>('dg_native_order_kitchen_apply',[id,input]);}
 async kitchenResult(id:string):Promise<KitchenTicket>{return kitchenTicketSchema.parse(await this.call<unknown>('dg_native_order_kitchen_result',[id]));}
}
