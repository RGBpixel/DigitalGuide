import type {FastifyInstance} from 'fastify';
import {ZodError} from 'zod';
import {AppError} from '@digitalguide/domain';
export function setApiErrorHandler(app:FastifyInstance){
 app.setErrorHandler((error,req,reply)=>{
  const known=error instanceof AppError,validation=error instanceof ZodError,frameworkStatus=error instanceof Error&&'statusCode'in error&&typeof error.statusCode==='number'&&error.statusCode>=400&&error.statusCode<500?error.statusCode:500,status=known?error.status:validation?400:frameworkStatus;
  reply.code(status).send({error:{code:known?error.code:validation||status===400?'VALIDATION_FAILED':status===413?'FILE_TOO_LARGE':status===415?'UNSUPPORTED_MEDIA_TYPE':'INTERNAL_ERROR',message:known?error.message:validation||status===400?'输入不符合要求，请检查必填项、格式和有效期。':status===413?'文件过大，请使用不超过 8 MB 的素材。':status===415?'请求格式不受支持，请使用 application/json 提交。':'服务暂时无法处理，请重试或联系管理员。',retryable:known?error.retryable:status>=500},requestId:req.id});
 });
}
