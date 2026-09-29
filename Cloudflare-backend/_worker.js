/*
  MEU MERCADO V48.3 — IA
  Mantém o layout do aplicativo e atende as rotas /api/* no mesmo domínio.

  IA principal:
    Cloudflare Workers AI (binding: AI)
    @cf/meta/llama-3.2-11b-vision-instruct

  Fallback:
    Gemini API via Secret GEMINI_API_KEY

  Nenhuma chave de API é colocada no index.html.
*/
const CATS = ['Mercearia','Carnes','Hortifruti','Laticínios','Limpeza','Outros'];
const CF_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

function json(data, status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store',
      'access-control-allow-origin':'*',
      'access-control-allow-methods':'GET,POST,OPTIONS',
      'access-control-allow-headers':'Content-Type'
    }
  });
}

function cleanJson(text){
  return String(text||'')
    .replace(/^```(?:json)?\s*/i,'')
    .replace(/\s*```$/,'')
    .trim();
}

function dataUrl(image,mime){
  return `data:${mime};base64,${image}`;
}

function promptFor(mode){
  if(mode==='identify'){
    return `Analise a foto de uma embalagem de produto de supermercado brasileiro.
Identifique somente o NOME comercial e a MARCA que estejam visíveis.
Não invente a marca. Se não estiver legível, use string vazia.
Não coloque peso, preço ou quantidade no nome.
Responda SOMENTE JSON válido neste formato:
{"name":"string","brand":"string"}`;
  }
  return `Leia esta nota ou cupom fiscal de supermercado brasileiro.
Extraia somente os produtos comprados com segurança.
Para cada item informe nome curto, quantidade, PREÇO UNITÁRIO e categoria.
Se a nota mostrar preço total da linha e quantidade, calcule o preço unitário.
Não inclua subtotal, total, impostos, descontos, forma de pagamento ou dados pessoais.
Categorias permitidas: Mercearia, Carnes, Hortifruti, Laticínios, Limpeza, Outros.
Responda SOMENTE JSON válido neste formato:
{"items":[{"name":"string","qty":1,"price":0,"cat":"Outros"}]}`;
}

function normalize(mode, parsed, provider){
  if(mode==='identify'){
    return {
      name:String(parsed?.name||'').trim(),
      brand:String(parsed?.brand||'').trim(),
      provider
    };
  }
  const items=Array.isArray(parsed?.items) ? parsed.items.map(x=>({
    name:String(x?.name||'Produto').trim(),
    qty:Math.max(1,Math.round(Number(x?.qty)||1)),
    price:Math.max(0,Number(x?.price)||0),
    cat:CATS.includes(x?.cat)?x.cat:'Outros'
  })).filter(x=>x.name) : [];
  return {items,provider};
}

async function runCloudflareAI(env, image, mimeType, mode){
  if(!env.AI) return null;

  const prompt=promptFor(mode);
  try{
    const result=await env.AI.run(CF_MODEL,{
      prompt,
      image:dataUrl(image,mimeType),
      max_tokens:500,
      temperature:0.1
    });

    const raw=String(result?.response || result?.text || '').trim();
    if(!raw) throw new Error('Workers AI não retornou texto.');
    const parsed=JSON.parse(cleanJson(raw));
    return normalize(mode,parsed,'cloudflare-ai');
  }catch(error){
    console.warn('Cloudflare Workers AI falhou; tentando Gemini:',error?.message||error);
    return null;
  }
}

async function getModels(key){
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',{
    headers:{'x-goog-api-key':key}
  });
  const raw=await r.text();
  let body={};
  try{body=JSON.parse(raw)}catch{}
  if(!r.ok) return {ok:false,status:r.status,error:body?.error?.message||raw||'Erro ao consultar Gemini.'};
  const models=(body.models||[])
    .filter(m=>Array.isArray(m.supportedGenerationMethods)&&m.supportedGenerationMethods.includes('generateContent'))
    .map(m=>String(m.name||'').replace(/^models\//,''))
    .filter(Boolean);
  return {ok:true,models};
}

async function runGemini(env,image,mimeType,mode){
  if(!env.GEMINI_API_KEY) return null;

  const discovery=await getModels(env.GEMINI_API_KEY);
  if(!discovery.ok){
    const msg=discovery.status===401||discovery.status===403
      ? 'A GEMINI_API_KEY foi recusada. Cadastre uma chave válida da Gemini API como Secret no Worker.'
      : discovery.error;
    throw new Error(msg);
  }

  const preferred=[
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite'
  ];
  const ordered=[
    ...preferred.filter(m=>discovery.models.includes(m)),
    ...discovery.models.filter(m=>/flash/i.test(m)&&!preferred.includes(m)),
    ...discovery.models.filter(m=>!/flash/i.test(m)&&!preferred.includes(m))
  ];
  if(!ordered.length) throw new Error('A chave Gemini não possui modelo compatível com generateContent.');

  for(const model of ordered){
    try{
      const schema=mode==='identify'
        ? {type:'object',properties:{name:{type:'string'},brand:{type:'string'}},required:['name','brand']}
        : {type:'object',properties:{items:{type:'array',items:{type:'object',properties:{
            name:{type:'string'},qty:{type:'integer',minimum:1},price:{type:'number',minimum:0},cat:{type:'string'}
          },required:['name','qty','price','cat']}}},required:['items']};

      const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
        method:'POST',
        headers:{'content-type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},
        body:JSON.stringify({
          contents:[{parts:[
            {inlineData:{mimeType,data:image}},
            {text:promptFor(mode)}
          ]}],
          generationConfig:{
            responseMimeType:'application/json',
            responseSchema:schema,
            temperature:0.1
          }
        })
      });
      const raw=await r.text();
      if(!r.ok) continue;
      const body=JSON.parse(raw);
      const txt=body?.candidates?.[0]?.content?.parts?.find(p=>p.text)?.text||'';
      const parsed=JSON.parse(cleanJson(txt));
      return normalize(mode,parsed,'gemini');
    }catch(e){
      console.warn('Gemini model failed:',model,e?.message||e);
    }
  }
  throw new Error('O Gemini não conseguiu processar a imagem.');
}

async function analyze(env,request,mode){
  if(request.method!=='POST') return json({error:'Método não permitido.'},405);

  let body;
  try{body=await request.json()}catch{return json({error:'JSON inválido.'},400)}

  const image=body?.image;
  const mimeType=body?.mimeType||'image/jpeg';
  if(!image) return json({error:'Imagem não enviada.'},400);
  if(!/^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(mimeType)){
    return json({error:'Formato de imagem não suportado.'},400);
  }

  // Primeiro tenta Workers AI. Se não estiver configurado ou falhar,
  // tenta Gemini sem alterar o frontend.
  const cf=await runCloudflareAI(env,image,mimeType,mode);
  if(cf) return json(cf);

  try{
    const gemini=await runGemini(env,image,mimeType,mode);
    if(gemini) return json(gemini);
  }catch(e){
    return json({error:e?.message||'Não foi possível processar a imagem.'},502);
  }

  return json({
    error:'Nenhum serviço de IA está configurado. No Cloudflare, adicione o binding Workers AI chamado AI ou o Secret GEMINI_API_KEY e publique novamente.'
  },503);
}

export default{
  async fetch(request,env){
    if(request.method==='OPTIONS'){
      return new Response(null,{status:204,headers:{
        'access-control-allow-origin':'*',
        'access-control-allow-methods':'GET,POST,OPTIONS',
        'access-control-allow-headers':'Content-Type',
        'access-control-max-age':'86400'
      }});
    }

    const url=new URL(request.url);

    if(url.pathname==='/api/ai-status'){
      const hasAI=Boolean(env.AI);
      let gemini=false;
      if(env.GEMINI_API_KEY){
        const d=await getModels(env.GEMINI_API_KEY);
        gemini=d.ok;
      }
      return json({ok:hasAI||gemini,cloudflareAI:hasAI,gemini,model:CF_MODEL});
    }

    if(url.pathname==='/api/identify-product') return analyze(env,request,'identify');
    if(url.pathname==='/api/read-receipt') return analyze(env,request,'receipt');

    if(env.ASSETS) return env.ASSETS.fetch(request);
    return json({error:'Rota não encontrada.'},404);
  }
};
