const encoder = new TextEncoder();
const privateResponse = (body,status,headers={}) =>
  new Response(body,{status,headers:{...headers,'Cache-Control':'private, no-store'}});

export default {
  async fetch(request,env) {
    if (!env.STORAGE_SECRET) return privateResponse(null,403);
    const actual = encoder.encode(request.headers.get('Authorization') || '');
    const expected = encoder.encode('Bearer '+env.STORAGE_SECRET);
    if (actual.length !== expected.length || !crypto.subtle.timingSafeEqual(actual,expected)) {
      return privateResponse(null,403);
    }
    const path = new URL(request.url).pathname;
    const match = path.match(/^\/__storage\/((?:dishes|originals|data|site)\/(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*)$/);
    if (!match) return privateResponse(null,404);
    const key = match[1];
    if (request.method === 'PUT') {
      await env.FILES.put(key,request.body,{httpMetadata:{contentType:request.headers.get('Content-Type') || 'application/octet-stream'}});
      return privateResponse(null,204);
    }
    if (request.method === 'DELETE') {
      await env.FILES.delete(key);
      return privateResponse(null,204);
    }
    if (!['GET','HEAD'].includes(request.method)) return privateResponse(null,405);
    const object = request.method === 'HEAD' ? await env.FILES.head(key) : await env.FILES.get(key);
    if (!object) return privateResponse(null,404);
    return privateResponse(object.body ?? null,200,{'Content-Type':object.httpMetadata?.contentType || 'application/octet-stream','Content-Length':String(object.size)});
  }
};
