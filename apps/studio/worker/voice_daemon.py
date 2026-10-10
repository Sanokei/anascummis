"""One CPU voice kept resident; JSONL IPC never executes caller code."""
import base64, io, json, sys, wave
import onnxruntime as ort
from piper import PiperVoice
from piper.config import PiperConfig
from piper.phonemize_espeak import ESPEAK_DATA_DIR
options = ort.SessionOptions()
options.intra_op_num_threads = 2
options.inter_op_num_threads = 1
model = sys.argv[1]
with open(model + '.json', encoding='utf-8') as config_file:
    config = PiperConfig.from_dict(json.load(config_file))
voice = PiperVoice(session=ort.InferenceSession(model, sess_options=options, providers=['CPUExecutionProvider']), config=config, espeak_data_dir=ESPEAK_DATA_DIR)
print(json.dumps({'ready': True}), flush=True)
for line in sys.stdin:
    try:
        request = json.loads(line)
        text = request['text']
        if not isinstance(text, str) or len(text) > 4000:
            raise ValueError('Invalid speech text')
        output = io.BytesIO()
        with wave.open(output, 'wb') as wav:
            voice.synthesize_wav(text, wav)
        encoded = base64.b64encode(output.getvalue()).decode('ascii')
        print(json.dumps({'audio': encoded}), flush=True)
    except Exception as error:
        print(json.dumps({'error': str(error)[:300]}), flush=True)

