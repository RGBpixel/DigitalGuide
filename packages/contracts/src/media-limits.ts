// 4096² RGBA原始像素、逐行过滤字节及有界PNG封装开销。
// 普通上传继续沿用8MB；此限制用于已解码生成的PNG与工程包中的PNG。
export const storedPngMaximumBytes=64*1024*1024+64*1024;
// 已生成或开放工程包中的PCM WAV；普通上传仍限制8MB。
export const storedWavMaximumBytes=64*1024*1024;
