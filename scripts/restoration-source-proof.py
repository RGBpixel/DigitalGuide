"""Validate official tensor data without executing checkpoint globals; independent NumPy reference."""
import collections
import hashlib
import io
import json
import pathlib
import pickle
import zipfile
import sys
import numpy as np
import onnx
from onnx import numpy_helper

ROOT = pathlib.Path.cwd()
FOLDER = pathlib.Path(sys.argv[1] if len(sys.argv)>1 else ROOT / 'docs/evidence/T24/restoration/source-proof-reproduced')
DATA = FOLDER / 'reference-data'
FOLDER.mkdir(parents=True, exist_ok=True)
assert not (FOLDER/'proof.json').exists()
DATA.mkdir(parents=True, exist_ok=True)
checkpoint = ROOT / 'storage/tools/restoration/realesr-general-x4v3.pth'
model_file = ROOT / 'storage/tools/restoration/realesr-general-x4v3-fp32.onnx'
sha = lambda raw: hashlib.sha256(raw).hexdigest()
assert sha(checkpoint.read_bytes()) == '8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292'
assert sha(model_file.read_bytes()) == '7b10e80021ec3e0ff35017ae5022791879d93a799b2e201e1010a37510202266'

class FloatStorage:
    pass

class Storage:
    def __init__(self, key, count):
        self.key, self.count = key, count

def tensor(storage, offset, shape, strides, requires_grad, hooks, metadata=None):
    assert isinstance(storage, Storage) and isinstance(offset, int) and offset >= 0
    assert isinstance(shape, tuple) and 1 <= len(shape) <= 4
    expected, n = [], 1
    for size in reversed(shape):
        assert isinstance(size, int) and 1 <= size <= 1000000
        expected.insert(0, n)
        n *= size
    assert tuple(expected) == strides and n <= 1000000 and offset+n <= storage.count
    assert isinstance(hooks, collections.OrderedDict) and not hooks
    return {'storage': storage, 'offset': offset, 'shape': shape, 'count': n}

class Restricted(pickle.Unpickler):
    def find_class(self, module, name):
        allowed = {('collections', 'OrderedDict'): collections.OrderedDict,
                   ('torch', 'FloatStorage'): FloatStorage,
                   ('torch._utils', '_rebuild_tensor_v2'): tensor}
        if (module, name) not in allowed:
            raise ValueError('Unapproved checkpoint global: ' + module + '.' + name)
        return allowed[(module, name)]

    def persistent_load(self, value):
        assert isinstance(value, tuple) and len(value) == 5
        kind, dtype, key, location, count = value
        assert kind == 'storage' and dtype is FloatStorage and str(key).isdigit()
        assert isinstance(count, int) and 0 < count <= 1000000
        assert isinstance(location, str) and location in ('cpu', 'cuda:0')
        return Storage(str(key), count)

with zipfile.ZipFile(checkpoint) as archive:
    infos = archive.infolist()
    assert len(infos) == 103 and sum(i.file_size for i in infos) < 6000000
    assert all(not i.is_dir() and i.file_size < 5000000 for i in infos)
    source = Restricted(io.BytesIO(archive.read('archive/data.pkl'))).load()
    assert set(source) == {'params'}
    descriptors = source['params']
    weights = collections.OrderedDict()
    for name, item in descriptors.items():
        storage = item['storage']
        raw = archive.read('archive/data/' + storage.key)
        assert len(raw) == storage.count*4
        values = np.frombuffer(raw, dtype='<f4', count=item['count'], offset=item['offset']*4).copy().reshape(item['shape'])
        assert np.all(np.isfinite(values))
        weights[name] = values
assert len(weights) == 101
assert weights['body.0.weight'].shape == (64, 3, 3, 3)
assert weights['body.66.weight'].shape == (48, 64, 3, 3)
for i in range(1, 66, 2):
    assert weights[f'body.{i}.weight'].shape == (64,)
for i in range(2, 66, 2):
    assert weights[f'body.{i}.weight'].shape == (64, 64, 3, 3)

model = onnx.load(str(model_file), load_external_data=False)
onnx.checker.check_model(model)
assert all(t.data_location != onnx.TensorProto.EXTERNAL for t in model.graph.initializer)
assert all(n.domain in ('', 'ai.onnx') for n in model.graph.node)
model_tensors = list(model.graph.initializer) + [a.t for n in model.graph.node if n.op_type == 'Constant' for a in n.attribute if a.type == onnx.AttributeProto.TENSOR]
initializer_hashes = collections.Counter(sha(numpy_helper.to_array(t).astype('<f4').tobytes()) for t in model_tensors if t.data_type == onnx.TensorProto.FLOAT)
source_hashes = collections.Counter(sha(t.astype('<f4').tobytes()) for t in weights.values())
assert not (source_hashes - initializer_hashes), 'Converted parameters differ from the official trained checkpoint.'
expected_operators = {'Conv', 'PRelu', 'DepthToSpace', 'Resize', 'Add', 'Constant', 'Clip'}
assert set(n.op_type for n in model.graph.node) <= expected_operators
assert sum(n.op_type == 'Conv' for n in model.graph.node) == 34
assert sum(n.op_type == 'PRelu' for n in model.graph.node) == 33
assert sum(n.op_type == 'DepthToSpace' for n in model.graph.node) == 1

def forward(image):
    x = image.copy()
    for i in range(67):
        w = weights[f'body.{i}.weight']
        if i % 2:
            x = np.where(x >= 0, x, x * w.reshape(1, 64, 1, 1))
        else:
            padded = np.pad(x, ((0,0), (0,0), (1,1), (1,1)))
            windows = np.lib.stride_tricks.sliding_window_view(padded, (3,3), axis=(2,3))
            x = np.einsum('nchwkl,ockl->nohw', windows, w, optimize=True) + weights[f'body.{i}.bias'].reshape(1,-1,1,1)
    _, _, h, w = x.shape
    x = x.reshape(1,3,4,4,h,w).transpose(0,1,4,2,5,3).reshape(1,3,h*4,w*4)
    return x + np.repeat(np.repeat(image,4,axis=2),4,axis=3)

cases=[]
for index, (height,width) in enumerate([(5,7),(9,13),(8,6)]):
    # Deterministic non-square, non-uniform, channel-distinct input independent of the ONNX graph.
    values=np.arange(3*height*width,dtype=np.float32).reshape(1,3,height,width)
    image=((values*13+index*7)%251)/250
    expected=forward(image.astype(np.float32))
    input_file=DATA/f'input-{index}.f32'; output_file=DATA/f'expected-{index}.f32'
    image.astype('<f4').tofile(input_file);expected.astype('<f4').tofile(output_file)
    cases.append({'input':str(input_file),'expected':str(output_file),'shape':[1,3,height,width],'outputShape':list(expected.shape),'expectedSHA256':sha(output_file.read_bytes())})
report={'result':'PASS_PARAMETER_IDENTITY_AND_REFERENCE_PREPARED','sourceSHA256':sha(checkpoint.read_bytes()),'onnxSHA256':sha(model_file.read_bytes()),'sourceParameterTensors':len(weights),'sourceParameterValues':sum(t.size for t in weights.values()),'sourceGlobalsNotExecuted':True,'parameterBytesExactlyPresentInONNX':True,'operators':dict(collections.Counter(n.op_type for n in model.graph.node)),'onnxVersion':onnx.__version__,'numpyVersion':np.__version__,'cases':cases,'wasmParityNotYetVerified':True,'reference':'Independent NumPy convolution/PReLU/PixelShuffle/nearest residual from official BSD-3-Clause SRVGGNetCompact.'}
assert not (FOLDER/'proof.json').exists()
(FOLDER/'proof.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({k:report[k] for k in ('result','sourceParameterTensors','sourceParameterValues','operators')}))
