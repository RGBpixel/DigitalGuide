# 本机语义检索组件来源与许可

固定模型：`Xenova/multilingual-e5-small`，原模型 `intfloat/multilingual-e5-small`。模型卡标注 MIT；上游为 Microsoft UniLM E5，MIT 版权声明为 Microsoft Corporation。随安装保留 E5-MIT.txt。ONNX 权重和分词数据的固定修订为 `761b726dd34fb83930e26aab4e9ac3899aa1fa78`，文件大小、摘要与来源在安装记录中单独保存。

主来源：[原模型卡](https://huggingface.co/intfloat/multilingual-e5-small)、[ONNX 模型卡](https://huggingface.co/Xenova/multilingual-e5-small)、[上游 MIT 许可](https://github.com/microsoft/unilm/blob/master/LICENSE)。下载可使用公开镜像，但必须匹配原站固定修订和上游 SHA-256，禁止执行远程自定义代码。

分词库：Hugging Face `@huggingface/tokenizers` 0.2.0，Apache-2.0，保留 TOKENIZERS-APACHE-2.0.txt。[官方代码](https://github.com/huggingface/tokenizers.js)。推理：Microsoft ONNX Runtime Web 1.31.1，MIT，保留 ONNXRUNTIME-MIT.txt。

模型协议：查询加 `query: `、段落加 `passage: `，注意力遮罩均值池化后 L2 归一化。原始隐藏层 384 维，余弦仅用于相对排序。单次最多256分词；长文本完整拆块并加权汇总，不截掉正文。固定策略与分词/运行时字节指纹进入方案和任务。没有生成式改写、识别身份或传播效果预测。

这是按许可证独立接入的基础组件，不是竞品代码、素材或其商标授权。原创与合成验证数据只用于流程和模型行为核对，不能替代授权真人素材、人工听审或通用语义召回率验收。
