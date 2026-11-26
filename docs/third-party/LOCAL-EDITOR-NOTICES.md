# 本机语义编辑模型与CPU运行时

原模型是[Qwen/Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507)，固定原修订cdbee75f17c01a7cc42f958dc650907174af0554，Apache-2.0许可见同目录QWEN3-APACHE-2.0.txt。

实际GGUF由[Unsloth发布者](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF)转换并标注同一原模型与Apache-2.0。固定修订a06e946bb6b655725eafa393f4a9745d460374c9，文件Qwen3-4B-Instruct-2507-Q8_0.gguf，4,280,405,600字节，SHA-256 391c1e410fd9f4cf2de2b510273b56a84c19ce18f4fa3bfb3774031dac4ef068。按发布者LFS摘要校验全部文件；这是Q8_0量化转换，不是原始FP32权重，不宣称逐参数精度相同。只读取模型数据，不执行发布者脚本或安装命令。

早期官方Qwen3-1.7B-Q8_0候选在本项目多轮改写检查中未达要求，输出和失败记录完整保留；它不是当前默认模型。原候选许可另存QWEN3-1.7B-APACHE-2.0.txt。

运行时来自[ggml-org/llama.cpp官方发布](https://github.com/ggml-org/llama.cpp/releases/tag/b12359)。CPU Windows x64归档llama-b12359-bin-win-cpu-x64.zip的官方SHA-256为837c1655e87df3b66989f4be33a792a1399c785bf259038dc75c900096683e69。实际版本1.0.0-dev、build12359、commit b1b770d90。MIT许可见LLAMA-CPP-MIT.txt；随附LLVM OpenMP依赖许可完整保存在LLVM-OPENMP-LICENSE.txt，包含适用例外，不省略依赖许可。固定所用程序和动态库摘要，CPU执行禁用GPU卸载，显式offline，仅使用已校验的本地模型路径。

模型只接收已选分镜文字与当前编辑要求，不具备业务工具、文件操作或发布权限。输出是待核对候选，不是事实保证、人工审核、真人语气/声音克隆或形象口型重新生成。质量、许可来源和业务授权分别记录；竞品研究不授予其代码、素材或模型使用权。
