import {setTimeout as delay} from 'node:timers/promises';

export const dishKey=(id,position)=>`dishes/${id}/${position}.webp`;
export const objectSchema=`CREATE TABLE IF NOT EXISTS dish_objects (
  menu_id TEXT NOT NULL REFERENCES menus(id), position INTEGER NOT NULL, object_key TEXT NOT NULL,
  PRIMARY KEY(menu_id,position)
)`;

async function request(key,method,body,type) {
  const {R2_GATEWAY_URL:base,R2_GATEWAY_SECRET:secret}=process.env;
  if (!base || !secret) throw new Error('R2 storage is unconfigured');
  if (!/^(dishes|originals|site|data)\/(?:[\w-][\w.-]*\/)*[\w-][\w.-]*$/.test(key)) throw new Error('Invalid object key');
  for (let attempt=0;;attempt++) {
    try {
      const response=await fetch(new URL(key,base),{method,body,redirect:'error',
        headers:{Authorization:'Bearer '+secret,'Content-Type':type || 'application/octet-stream'},
        signal:AbortSignal.timeout(25_000)});
      if (response.ok) return method==='GET' ? Buffer.from(await response.arrayBuffer()) : null;
      await response.body?.cancel();
      const error=new Error('Object storage request failed ('+response.status+')');
      error.statusCode=response.status;
      throw error;
    } catch(error) {
      if (attempt>=2 || (error.statusCode && error.statusCode<500 && error.statusCode!==429)) throw error;
      await delay(300*(attempt+1));
    }
  }
}
export async function objectExists(key) {
  try {await request(key,'HEAD');return true;}
  catch(error) {if (error.statusCode===404) return false;throw error;}
}
export const getObject=key=>request(key,'GET');
export const putObject=(key,body,type)=>request(key,'PUT',body,type);
export const deleteObject=key=>request(key,'DELETE');
