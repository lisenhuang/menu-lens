import {scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {RequestError} from './providers.mjs';

const derive = promisify(scrypt);
export async function matchesPin(pin, verifier) {
  const match = /^([a-f0-9]{32}):([a-f0-9]{64})$/.exec(verifier || '');
  if (!match) throw new RequestError(503,'Admin sign-in is unavailable.');
  if (typeof pin!=='string' || !/^\d{6}$/.test(pin)) return false;
  const key = await derive(pin,Buffer.from(match[1],'hex'),32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  return timingSafeEqual(key,Buffer.from(match[2],'hex'));
}

// OpenAI's 1024 × 1024 standard Images API calculator, checked 2026-11-21.
// https://developers.openai.com/api/docs/guides/image-generation#calculating-costs
const outputTokens26={low:823,medium:1449,high:1756,xhigh:3122,max:7024};
const outputTokens25={low:196,medium:439,high:1756,xhigh:3122,max:7024};
export const imageModels={
  'gpt-image-2.6-flare':outputTokens26,
  'gpt-image-2.6-sunburst':outputTokens26,
  'gpt-image-2.5-flare':outputTokens25,
  'gpt-image-2.5-sunburst':outputTokens25,
  'gpt-image-2':{low:196,medium:1756,high:7024},
};
export const outputUsdPerMillion=30;
// Standard Responses API rates in USD per million tokens, from each model's OpenAI model card.
const legacyEfforts=['minimal','low','medium','high'];
const modernEfforts=['low','medium','high','xhigh','max'];
export const defaultReader=process.env.OPENAI_VISION_MODEL || 'gpt-6.1-terra';
export const defaultReadingEffort='medium';
export const readingModels={
  'gpt-5-mini':{efforts:legacyEfforts,input:0.25,cached:0.025,output:2},
  'gpt-5.4-mini':{efforts:['none','low','medium','high','xhigh'],input:0.75,cached:0.075,output:4.5},
  'gpt-6.1-terra':{efforts:['none',...modernEfforts],input:1,cached:0.05,output:5,longContext:true},
  'gpt-6.2-sol':{efforts:modernEfforts,input:2,cached:0.1,output:10,longContext:true},
  'gpt-6.2-astra':{efforts:modernEfforts,input:8,cached:0.4,output:40,longContext:true},
};
if (!Object.hasOwn(readingModels,defaultReader)) {
  const alias=defaultReader.replace(/-\d{4}-\d{2}-\d{2}$/,'');
  readingModels[defaultReader]=Object.hasOwn(readingModels,alias) ? readingModels[alias] : {efforts:legacyEfforts};
}
export function validateSettings({model,quality,readingModel,reasoning}) {
  if (typeof model!=='string' || typeof quality!=='string' || !Object.hasOwn(imageModels,model) || !Object.hasOwn(imageModels[model],quality)) {
    throw new RequestError(400,'Choose a supported image model and rendering quality.');
  }
  if (typeof readingModel!=='string' || !Object.hasOwn(readingModels,readingModel) || !readingModels[readingModel].efforts.includes(reasoning)) {
    throw new RequestError(400,'Choose a supported menu-reading model and thinking level.');
  }
  return {model,quality,readingModel,reasoning};
}
