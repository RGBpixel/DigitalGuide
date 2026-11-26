# 本机神经修复与超分的模型来源

Real-ESRGAN / SRVGGNetCompact，Copyright (c) 2021, Xintao Wang，BSD-3-Clause。保留同目录REALESRGAN-BSD-3-Clause.txt。原始官方参数为 `realesr-general-x4v3.pth`，4,885,111字节，SHA-256 `8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292`。

来源：[官方仓库](https://github.com/xinntao/Real-ESRGAN)、[官方许可](https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE)、[官方发布参数](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth)、[SRVGG架构](https://github.com/xinntao/Real-ESRGAN/blob/master/realesrgan/archs/srvgg_arch.py)。

固定ONNX转换：[vlad-grig/realesr-general-x4v3-onnx](https://huggingface.co/vlad-grig/realesr-general-x4v3-onnx)，修订 `0e95d93e454cf6b5de9bdf5a1c9e7ec340d38231`，`onnx/model.onnx`，4,866,420字节，SHA-256 `7b10e80021ec3e0ff35017ae5022791879d93a799b2e201e1010a37510202266`。发布者标注相同BSD-3-Clause许可。项目逐字节核对其101组参数与实际从官方地址取得的原始文件，并使用独立NumPy卷积、PReLU、像素重排和残差计算验证本机WASM输出。不会执行checkpoint携带的任意Python全局对象。

初选另一转换文件存在FP16舍入，未作为此全精度模型安装；失败与比对记录保留。当前选择没有用半精度回转浮点冒充原始全精度参数。Python/NumPy/ONNX仅用于开发验证，不是服务端运行依赖；实际处理仍为锁定的ONNX Runtime Web 1.31.1单线程CPU/WASM，其MIT许可另附ONNXRUNTIME-MIT.txt。

原生模型为RGB四倍超分；1/2倍输出以面积平均缩回，Alpha独立插值，源8位像素送入浮点模型。分块反射边缘、透明像素填色和结果融合是本项目的版本化处理策略。输出是预测的纹理，不能保证恢复丢失的真实细节；没有接入人脸识别、人物重建、专门划痕/上色模型或时序稳定模型。原素材和用途继续独立保护。

安装脚本只校验固定文件和实际RGB计算。素材来源、模型许可、真实内容质量和竞品研究分别记录；这些公开参数不授予竞品代码、品牌或真人素材使用权。
