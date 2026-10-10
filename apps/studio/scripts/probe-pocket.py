import time, torch
from pocket_tts import TTSModel
import soundfile as sf
torch.set_num_threads(2)
started=time.perf_counter()
model=TTSModel.load_model()
voice=model.get_state_for_audio_prompt('alba')
print('warmMs',round((time.perf_counter()-started)*1000),flush=True)
started=time.perf_counter();chunks=[]
for chunk in model.generate_audio_stream(voice,"Hi! I'm here. What would you like to create today?"):
 if not chunks: print('firstAudioMs',round((time.perf_counter()-started)*1000),flush=True)
 chunks.append(chunk)
sf.write('.runtime/pocket-sample.wav',torch.cat(chunks).numpy(),model.sample_rate)
print('totalMs',round((time.perf_counter()-started)*1000),flush=True)
