self.addEventListener("install",e=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("push",event=>{
  let data={title:"Regenmelder",body:"Neue Regenmeldung",url:"./"};
  try{if(event.data)data={...data,...event.data.json()};}catch{}
  event.waitUntil(self.registration.showNotification(data.title||"Regenmelder",{
    body:data.body||"Neue Regenmeldung",
    icon:"./icons/icon-192.png",
    badge:"./icons/icon-192.png",
    data:{url:data.url||"./"},
    tag:data.tag||"regenmelder"
  }));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=event.notification.data?.url||"./";
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    for(const c of list){if("focus" in c)return c.focus();}
    return clients.openWindow(target);
  }));
});
