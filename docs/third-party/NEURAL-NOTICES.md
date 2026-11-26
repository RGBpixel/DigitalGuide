# 本地前景分割组件与来源

本模块使用U²-Net-P已训练参数执行通用显著前景分割；不复制竞品平台代码，不使用真实人员素材训练或测试，不提供身份识别。推理代码为本项目实现，预处理尺寸/归一化参考公开模型协议。

- 模型架构及参数来源：[Xuebin Qin等人的U²-Net项目](https://github.com/xuebinqin/U-2-Net)，论文为U²-Net: Going Deeper with Nested U-Structure for Salient Object Detection，Pattern Recognition 106 (2020), 107404。原项目公开[Apache License 2.0](https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE)；标准完整条款随本文件保存在[Apache许可文本](U2Net-APACHE-2.0.txt)。这份条款文本使用已安装的标准Apache-2.0文本，不声称与上游许可证文件的空白排版逐字节相同。
- ONNX参数文件：[rembg发布的u2netp.onnx](https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx)。固定长度4,574,861字节、SHA-256为309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8；另与[rembg会话源码](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2netp.py)公布的MD5 8e83ca70e441ab06c318d82300c84806交叉核对。参数许可采用原U²-Net项目的Apache-2.0，不将rembg自身MIT许可替换为模型许可。
- 取得路径：先用上述原发布地址；网络不可达时，只从固定NPM包@rmbg/model-u2netp@0.0.1的存档中读取同一参数文件，校验固定tarball SHA-512以及上述模型SHA-256/长度/MD5。存档中的JavaScript、声明或脚本不安装、不执行。此镜像不改变参数、算法或原许可；下载核对事实保存在本机安装元数据中。
- 运行时：[Microsoft ONNX Runtime Web](https://github.com/microsoft/onnxruntime/tree/main/js/web)，1.31.1，MIT。官方支持Node.js单线程WebAssembly；本项目明确使用该路径，不声称启用了CUDA、DirectML或实时视频。运行库由锁定的NPM依赖提供；已核对[官方许可与微软版权声明](https://github.com/microsoft/onnxruntime/blob/main/LICENSE)，副本为[ONNXRUNTIME-MIT.txt](ONNXRUNTIME-MIT.txt)，安装时同放入模型目录。其他组件声明以[上游ThirdPartyNotices](https://github.com/microsoft/onnxruntime/blob/main/ThirdPartyNotices.txt)及实际发行构建为准。

安装后的模型和运行时只在服务端本机读取。安装会访问公开包/模型地址，推理不会上传输入图片、视频或遮罩。生产重分发应一并携带这些许可、署名、实际参数版本和运行时的第三方声明；本批不代表生产发行或第三方法律审计。
