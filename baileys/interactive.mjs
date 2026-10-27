export function selectionText(content) {
  const selected=content?.buttonsResponseMessage?.selectedButtonId || content?.listResponseMessage?.singleSelectReply?.selectedRowId || content?.templateButtonReplyMessage?.selectedId;
  if(selected)return selected;
  const native=content?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if(native){try{const data=JSON.parse(native);if(typeof data.id==='string')return data.id;if(typeof data.selected_row_id==='string')return data.selected_row_id;}catch{}}
  return content?.conversation || content?.extendedTextMessage?.text || '';
}
export function listContent(data) {
 if(typeof data.title!=='string'||!data.title.trim()||data.title.length>60||typeof data.button!=='string'||!data.button.trim()||data.button.length>20||!Array.isArray(data.sections)||data.sections.length!==1)throw new Error('invalid_list');
 const section=data.sections[0];
 if(typeof section.title!=='string'||section.title.length>24||!Array.isArray(section.rows)||!section.rows.length||section.rows.length>10)throw new Error('invalid_list');
 const ids=new Set();
 for(const row of section.rows){if(typeof row.rowId!=='string'||!/^scv:(report|page):[a-f0-9]{16}:\d+$/.test(row.rowId)||ids.has(row.rowId)||typeof row.title!=='string'||!row.title.trim()||row.title.length>24||typeof row.description!=='string'||row.description.length>72)throw new Error('invalid_list');ids.add(row.rowId);}
 return {listMessage:{title:data.title,description:data.content,buttonText:data.button,listType:1,sections:data.sections}};
}

export function listRelayOptions(messageId) {
  return {messageId, additionalNodes:[{tag:'biz', attrs:{}, content:[{tag:'list', attrs:{type:'product_list',v:'2'}}]}]};
}

export function buttonsContent(data) {
 if(!Array.isArray(data.buttons)||(data.buttons.length<1||data.buttons.length>3)||typeof data.content!=='string'||!data.content.trim())throw new Error('invalid_buttons');
 const ids=new Set();
 for(const b of data.buttons){if(!(/^(?:scv:menu|scv:(again|new):[a-f0-9-]{36}|scv:date:[a-f0-9]{16}:(today|yesterday))$/.test(b.id))||typeof b.title!=='string'||!b.title.trim()||b.title.length>20||ids.has(b.id))throw new Error('invalid_buttons');ids.add(b.id);}
 return {viewOnceMessage:{message:{messageContextInfo:{deviceListMetadata:{},deviceListMetadataVersion:2},interactiveMessage:{body:{text:data.content},nativeFlowMessage:{buttons:data.buttons.map(b=>({name:'quick_reply',buttonParamsJson:JSON.stringify({display_text:b.title,id:b.id})}))}}}}};
}
export function buttonsRelayOptions(messageId) {
 return {messageId,additionalNodes:[{tag:'biz',attrs:{},content:[{tag:'interactive',attrs:{type:'native_flow',v:'1'},content:[{tag:'native_flow',attrs:{v:'9',name:'mixed'}}]}]}]};
}

export function documentFilename(value) {
 const name=typeof value==='string'?value.normalize('NFC'):'';
 return name.replace(/[\\/\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,160)||'relatorio.pdf';
}
