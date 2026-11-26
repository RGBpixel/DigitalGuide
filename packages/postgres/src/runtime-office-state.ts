import {createHash} from 'node:crypto';
import {canonical} from '../../domain/src/index.js';
import type {OfficeRelay,OfficeNotification,CalendarEvent} from '../../contracts/src/index.js';
import {nativeBusinessInteger as integer} from './runtime-repository.js';

export interface NativeOfficeScope {id:string;tenant_id:string;workspace_id:string;version:number;revision:number;expires_at:string;environment:string;app_env:string;created_at:string;updated_at:string}
export interface NativeOfficeRelay extends NativeOfficeScope {sender_user_id:string;recipient_user_id:string;subject:string;body:string;confidentiality:OfficeRelay['confidentiality'];channel:'local'|'mock';scenario:'normal'|'failed'|'unknown';status:OfficeRelay['status'];scheduled_at:string|null}
export interface NativeOfficeEvent extends NativeOfficeScope {organizer_user_id:string;title:string;description:string;location:string;starts_at:string;ends_at:string;timezone:string;reminder_minutes:number;channel:'local'|'mock';status:CalendarEvent['status']}
export interface NativeOfficeNotice {id:string;tenant_id:string;workspace_id:string;source_kind:'relay'|'event';source_id:string;source_revision:number;recipient_user_id:string;kind:OfficeNotification['kind'];due_at:string;expires_at:string;channel:'local'|'mock';scenario:'normal'|'failed'|'unknown';status:OfficeNotification['status'];dispatch_status:OfficeNotification['dispatchStatus'];version:number;attempts:number;lease_token:string|null;lease_until:string|null;remote_id:string|null;error_code:string|null;read_at:string|null;acknowledged_at:string|null;environment:string;app_env:string;created_at:string;updated_at:string}
export interface NativeOfficeSource {title:string;body:string;senderId:string}
export const officeHash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export function officeRelayRow(r:NativeOfficeRelay):NativeOfficeRelay{return{...r,version:integer(r.version),revision:integer(r.revision)};}
export function officeEventRow(r:NativeOfficeEvent):NativeOfficeEvent{return{...r,version:integer(r.version),revision:integer(r.revision),reminder_minutes:integer(r.reminder_minutes)};}
export function officeNoticeRow(r:NativeOfficeNotice):NativeOfficeNotice{return{...r,version:integer(r.version),source_revision:integer(r.source_revision),attempts:integer(r.attempts)};}
export const officeIso=(v:string)=>new Date(v).toISOString();
