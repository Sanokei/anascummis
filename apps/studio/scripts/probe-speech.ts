import {warmSpeech,speak,stopSpeech} from '../core/speech';
const start=performance.now();try{await warmSpeech();console.log('warmMs',Math.round(performance.now()-start));for(const text of ['I will look that up for you.','Recent headlines report continuing difficulties in Yemen.']){const t=performance.now(),audio=await speak(text);console.log(JSON.stringify({text,synthesisMs:Math.round(performance.now()-t),bytes:audio.length}));await Bun.write('.runtime/probe-speech.wav',audio);}}finally{stopSpeech();}


