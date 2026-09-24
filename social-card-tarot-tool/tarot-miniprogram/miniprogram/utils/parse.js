// Generated from the existing validated response parser.
function parseReadingResponse(raw,cards){
  let text=raw.trim();
  if(text.startsWith('event:')||text.startsWith('data:')){
    let complete=false,failed=false;
    text=text.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>{
      const data=line.slice(5).trim();if(data==='[DONE]'){complete=true;return '';}
      const event=JSON.parse(data);if(event.type==='message_stop')complete=true;if(event.type==='error')failed=true;
      return typeof event.delta?.text==='string'?event.delta.text:'';
    }).join('');
    if(!complete||failed)throw new Error('解读传输中断，请重试。');
  }
  let result=JSON.parse(text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
  // Also support the Anthropic JSON envelope used by compatible backends.
  if(Array.isArray(result.content))result=JSON.parse(result.content.map(c=>c.text||'').join(''));
  const validText=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
  if(!validText(result.summary,3000)||!Array.isArray(result.cards)||result.cards.length!==3||result.cards.some((c,i)=>c.id!==cards[i].id||!validText(c.text,2500))||!Array.isArray(result.advice)||result.advice.length<1||result.advice.length>3||result.advice.some(s=>!validText(s,1000)))throw new Error('解读内容不完整，请重试。');
  return result;
}
module.exports={parseReadingResponse};
