
function save(k,v){localStorage.setItem(k,JSON.stringify(v))}
function get(k){return JSON.parse(localStorage.getItem(k)||"null")}
