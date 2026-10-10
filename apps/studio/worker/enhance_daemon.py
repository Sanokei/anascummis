import sys, json, base64, io, os
import numpy as np
import soundfile as sf
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lavasr'))
from lavasr_core import LavaEnhancer, _resample_poly_1d
root = os.path.dirname(os.path.dirname(__file__))
weights = os.path.join(root, '.runtime', 'lavasr')
model = LavaEnhancer(os.path.join(root,'worker','lavasr','config.yaml'), os.path.join(weights,'enhancer_backbone.onnx'), os.path.join(weights,'enhancer_spec_head.onnx'), ort_intra_op_num_threads=2)
print(json.dumps({'ready':True}),flush=True)
for line in sys.stdin:
    try:
        value=json.loads(line)
        raw=base64.b64decode(value['audio'],validate=True)
        if len(raw)>3000000: raise ValueError('Audio too long')
        audio, rate=sf.read(io.BytesIO(raw),dtype='float32')
        if audio.ndim!=1 or rate!=24000: raise ValueError('Expected 24 kHz mono speech')
        original=_resample_poly_1d(audio,rate,48000)
        model.merge.cutoff=10000
        enhanced=model.infer(original[None,:])[0]
        if not np.all(np.isfinite(enhanced)): raise ValueError('Nonfinite enhanced audio')
        output=io.BytesIO();sf.write(output,np.clip(enhanced,-1,1),48000,format='WAV',subtype='PCM_16')
        print(json.dumps({'audio':base64.b64encode(output.getvalue()).decode()}),flush=True)
    except Exception as error: print(json.dumps({'error':str(error)[:300]}),flush=True)
