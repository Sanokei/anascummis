"""Resident CPU TTS and enhancer; cancel generation without unloading either model."""
import os,sys,json,base64,threading,queue,math
import numpy as np
import torch
from pocket_tts import TTSModel
os.environ['HF_HUB_OFFLINE']='1'
torch.set_num_threads(2)
torch.set_num_interop_threads(1)
sys.path.insert(0,os.path.join(os.path.dirname(__file__),'lavasr'))
from lavasr_core import LavaEnhancer,_resample_poly_1d
root=os.path.dirname(os.path.dirname(__file__))
weights=os.path.join(root,'.runtime','lavasr')
model=TTSModel.load_model()
voice=model.get_state_for_audio_prompt('alba')
enhancer=LavaEnhancer(os.path.join(root,'worker','lavasr','config.yaml'),os.path.join(weights,'enhancer_backbone.onnx'),os.path.join(weights,'enhancer_spec_head.onnx'),ort_intra_op_num_threads=2)
enhancer.merge.cutoff=10000
requests=queue.Queue();stops={}
def read_input():
    for line in sys.stdin:
        try:
            request=json.loads(line)
            if 'cancel' in request:
                event=stops.get(request['cancel'])
                if event:event.set()
            else:
                stops[request['id']]=threading.Event();requests.put(request)
        except Exception:pass
    for event in stops.values():event.set()
    requests.put(None)
threading.Thread(target=read_input,daemon=True).start()
def emit(value):print(json.dumps(value),flush=True)
emit({'ready':True})
while True:
    request=requests.get()
    if request is None:break
    identifier=request.get('id');stop=stops[identifier]
    try:
        text=request['text']
        if not isinstance(text,str) or len(text)>4000:raise ValueError('Invalid speech text')
        pending=[];count=0;previous=np.empty(0,dtype=np.float32)
        def send(samples):
            global previous
            context=np.concatenate([previous,samples]);resampled=_resample_poly_1d(context,24000,48000)
            enhanced=enhancer.infer(resampled[None,:])[0][len(previous)*2:]
            previous=context[-2880:]
            if not np.all(np.isfinite(enhanced)):raise ValueError('Invalid enhanced audio')
            pcm=(np.clip(enhanced,-1,1)*32767).astype('<i2')
            if not stop.is_set():emit({'id':identifier,'audio':base64.b64encode(pcm.tobytes()).decode(),'rate':48000,'encoding':'pcm16'})
        for chunk in model.generate_audio_stream(voice,text,stop=stop):
            if stop.is_set():break
            pending.append(chunk.numpy());count+=chunk.numel()
            if count>=7680:send(np.concatenate(pending));pending=[];count=0
        if pending and not stop.is_set():send(np.concatenate(pending))
    except Exception as error:emit({'id':identifier,'error':str(error)[:300]})
    finally:emit({'id':identifier,'done':True});stops.pop(identifier,None)

