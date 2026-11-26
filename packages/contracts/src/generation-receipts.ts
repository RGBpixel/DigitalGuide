import {z} from 'zod';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const generationDeclaration=z.enum(['ai_generated','ai_assisted','not_ai','unknown']);
export const governancePublicReceiptSchema=z.strictObject({
 format:z.literal('digitalguide-generation-receipt'),schemaVersion:z.literal(1),publicId:z.uuid(),
 generation:generationDeclaration,declarationVerified:z.literal(false),label:z.string(),
 source:z.strictObject({engine:z.literal('digitalguide.native_timeline'),inputVideoSHA256:hash,inputCoverSHA256:hash}),
 outputs:z.array(z.strictObject({kind:z.enum(['video','cover']),mediaType:z.string(),size:z.int(),sha256:hash})),
 policySHA256:hash,approvedAt:z.iso.datetime(),signatureAlgorithm:z.literal('HMAC-SHA256'),signature:hash,notice:z.string()
});
export type GovernancePublicReceipt=z.infer<typeof governancePublicReceiptSchema>;
