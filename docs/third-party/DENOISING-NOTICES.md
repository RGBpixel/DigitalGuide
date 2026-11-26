# DeepFilterNet 固定工具与模型

本项目R-076本机神经人声降噪使用Rikorose/DeepFilterNet的v0.5.6官方Windows x64程序及该版本DeepFilterNet3 ONNX模型。来源：[仓库](https://github.com/Rikorose/DeepFilterNet/tree/v0.5.6)、[release](https://github.com/Rikorose/DeepFilterNet/releases/tag/v0.5.6)、[模型](https://github.com/Rikorose/DeepFilterNet/blob/v0.5.6/models/DeepFilterNet3_onnx.tar.gz)。

项目根许可为MIT或Apache-2.0，版权声明为Copyright (c) 2021 Hendrik Schröter；本项目保留两份上游许可原文于storage/tools/denoising/LICENSE-MIT与LICENSE-APACHE。固定版本未发现模型目录另行许可例外，按根许可处理；此判断不延伸到其他数据集、声音、模型版本或第三方素材。

安装从官方GitHub API固定asset/blob获取，使用本项目取得后固定的SHA-256；release没有提供SHA-256 digest，不冒充发行方签名验证。模型额外检查官方Git blob一致性。说明、精确摘要、实际执行与有限质量结果见[神经降噪说明](../51-neural-denoising.md)。

程序与模型用于本机文件，不进行声纹身份确认、真人声音复刻或目标说话人分离。测试台词、噪声及色块由本项目原创，参考声音由已安装Windows系统SAPI生成；不把这些合成信号当作真实人物或全部设备/音色的验收。
