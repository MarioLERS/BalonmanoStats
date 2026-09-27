// ===== APP STATE =====
var timerInterval = null, timerSeconds = 0, timerRunning = false;
// Reloj de vídeo real: arranca con Iniciar, NO se pausa con Pausar (solo con Detener/Reiniciar).
// Corre siempre en paralelo al reloj del marcador y es la base para calibrar la exportación a XPS.
// `realStartTs` (2026-09-20): un móvil/tablet SUSPENDE los setInterval en segundo plano
// cuando se bloquea la pantalla — el navegador deja de ejecutar JS por completo para
// ahorrar batería, así que un contador que solo hace `realSeconds++` en cada "tic" pierde
// para siempre cada segundo que la pantalla estuvo bloqueada (reportado por el usuario:
// "el crono se detiene al bloquear la tablet, se descuadran los tiempos de los cortes").
// No hay forma de mantener el JS corriendo con la pantalla apagada (ninguna PWA puede), así
// que en vez de contar tics se guarda el instante real (Date.now()) en el que "arrancó" este
// tramo, y realSeconds se RECALCULA siempre a partir de la diferencia con el reloj real —
// así, en cuanto la app vuelve a ejecutarse (se desbloquea la tablet), el valor salta de
// golpe al tiempo correcto, sin haber perdido ni un segundo, en vez de haberse quedado
// parado todo el rato que estuvo bloqueada.
var realTimerInterval = null, realSeconds = 0, realTimerRunning = false, realStartTs = null;
// Multiplicador de velocidad (2026-09-27): para cuando el usuario ve el partido grabado
// en casa a x2, así el cronómetro y el reloj de vídeo real avanzan al doble por cada
// segundo real, y los tiempos registrados siguen cuadrando con el vídeo acelerado.
var timeSpeedMultiplier = 1;
function _syncRealSeconds(){
  if(realTimerRunning && realStartTs!==null) realSeconds = Math.floor((Date.now()-realStartTs)/1000*timeSpeedMultiplier);
  return realSeconds;
}
// Tics del cronómetro del partido y del reloj de vídeo real, en funciones aparte para
// poder reiniciar sus setInterval con un "tic" más corto al activar x2 (2026-09-27): antes
// se sumaban 2 segundos cada 1000ms, así que se veían saltos (20→22→24) en vez de contar de
// uno en uno al doble de velocidad. Ahora el tic dura 1000/multiplicador ms y suma siempre 1.
function _timerTick(){
  timerSeconds++;
  var p=porteros.find(function(x){return x.id===activePorteroId;}); if(p) p.seconds++;
  // 2 equipos: los dos porteros en juego suman tiempo a la vez
  if(dosEquipos){ var p2=porteros.find(function(x){return x.id===activePorteroId2;}); if(p2) p2.seconds++; }
  updateTimerDisplay(); updateActivePorteroTimeDisplay();
}
function _realTimerTick(){
  _syncRealSeconds();
  updateRealTimerDisplay();
}
function toggleTimeSpeed(){
  if(realTimerRunning) _syncRealSeconds(); // congela realSeconds con el multiplicador actual antes de cambiarlo
  timeSpeedMultiplier = (timeSpeedMultiplier===1)?2:1;
  if(realTimerRunning) realStartTs = Date.now() - Math.round(realSeconds*1000/timeSpeedMultiplier); // sin salto al cambiar
  // Reinicia los intervalos ya en marcha con el nuevo tic, para que se note el cambio al momento.
  if(timerRunning){ clearInterval(timerInterval); timerInterval=setInterval(_timerTick, 1000/timeSpeedMultiplier); }
  if(realTimerRunning){ clearInterval(realTimerInterval); realTimerInterval=setInterval(_realTimerTick, 1000/timeSpeedMultiplier); }
  var b=document.getElementById('btn-speed');
  if(b){
    b.textContent = timeSpeedMultiplier+'×';
    b.classList.toggle('active', timeSpeedMultiplier===2);
    b.title = timeSpeedMultiplier===2
      ? 'Velocidad x2 activada — vuelve a pulsar para volver a velocidad normal'
      : 'Duplica la velocidad del cronómetro y del reloj de vídeo, para cuando ves el partido grabado a x2';
  }
}
var scoreUs = 0, scoreThem = 0, scoreSwapped = false;
var radarShow = {gol:true, parada:true, pct:true};
var timelineShow = {gol:true, parada:true, pct:true};

function toggleTimeline(key){
  timelineShow[key]=!timelineShow[key];
  var btn=document.getElementById('tl-tog-'+key);
  if(btn){
    var colors={gol:'#ef4444',parada:'#22c55e',pct:'#3b82f6'};
    var c=colors[key];
    if(timelineShow[key]){
      btn.style.background='rgba('+hexToRgb(c)+',.15)';
      btn.style.borderColor=c; btn.style.color=c; btn.style.opacity='1';
    } else {
      btn.style.background='transparent'; btn.style.borderColor='rgba(255,255,255,.15)';
      btn.style.color='rgba(255,255,255,.3)'; btn.style.opacity='.5';
    }
  }
  drawTimeline(getFilteredShots());
}
function hexToRgb(hex){
  var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return r+','+g+','+b;
}
function timeToSec(t){
  if(!t) return 0;
  var p=t.split(':'); return parseInt(p[0]||0)*60+parseInt(p[1]||0);
}
function drawTimeline(fs){
  var cv=document.getElementById('timeline-canvas'); if(!cv) return;
  var dpr=window.devicePixelRatio||1;
  var W=cv.offsetWidth||800, H=cv.offsetHeight||340;
  cv.width=W*dpr; cv.height=H*dpr;
  cv.style.width=W+'px'; cv.style.height=H+'px';
  var ctx=cv.getContext('2d'); ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#091524'; ctx.fillRect(0,0,W,H);

  var PAD={t:16,r:38,b:36,l:44};
  var cw=W-PAD.l-PAD.r, ch=H-PAD.t-PAD.b;

  // 2026-09-20: los filtros de lanzamiento (zona, trayectoria, posición en portería,
  // habilidad) ya NO recortan este gráfico — solo resaltan sus puntos (ver "Shot markers"
  // más abajo). La evolución del partido se dibuja siempre con TODOS los lanzamientos de
  // la portera/jugador elegidos: esos dos filtros sí definen "de quién" es la evolución,
  // los demás solo señalan qué lanzamientos concretos mirar dentro de ella.
  // 2026-09-21: tampoco portera ni jugador recortan ya la gráfica: portera → engrosa sus tramos
  // y cambia solo la línea de %; jugador → marca sus acciones con punto (ver más abajo).
  // Filter out 'fuera', only count a puerta
  var relevant=shots.filter(function(s){return s.result!=='fuera';});
  if(!relevant.length){
    ctx.fillStyle='rgba(255,255,255,.2)'; ctx.font='13px DM Sans,sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('Sin lanzamientos registrados',W/2,H/2); return;
  }

  // Sort by time
  var sorted=relevant.slice().sort(function(a,b){return timeToSec(a.time)-timeToSec(b.time);});
  var maxSec=Math.max(timeToSec(sorted[sorted.length-1].time), 60);
  var totalMins=Math.ceil(maxSec/60);

  // Diagonal lines: one point per event at exact fractional minutes
  // gPct cuenta los goles que SÍ deben contar contra el % de paradas (excluye "sin portero",
  // igual que en el resto de la app) — g sigue llevando el total real de goles encajados.
  var g=0, p=0, gPct=0;
  var steps=[{t:0,g:0,p:0,gPct:0}];
  sorted.forEach(function(s){
    var t=timeToSec(s.time)/60;
    if(s.result==='gol'||s.result==='sinportero'){ g++; if(!s.noGk) gPct++; }
    else if(s.result==='parada') p++;
    steps.push({t:t,g:g,p:p,gPct:gPct});
  });
  steps.push({t:totalMins,g:g,p:p,gPct:gPct});

  var cumGol=steps.map(function(s){return s.g;});
  var cumPar=steps.map(function(s){return s.p;});
  var cumPct=steps.map(function(s){
    var tot=s.gPct+s.p; return tot>0?Math.round(s.p/tot*100):null;
  });
  // Portera seleccionada (2026-09-21): NO recorta la gráfica. onCourt[i] dice si el tramo
  // que llega al paso i (i-1 → i) ocurrió con ella en pista (dueña del lanzamiento; los de
  // 'Sin portero' heredan la del lanzamiento anterior) y esos tramos se dibujan más gruesos
  // en todas las líneas. La ÚNICA línea que cambia es el %: se calcula solo con sus lanzamientos
  // y arranca en 0% en cuanto entra en pista (no en 100% por una primera parada).
  var porteroSel = filterPortero!=='all';
  var onCourt = null;
  if(porteroSel){
    var owners=[], lastOwner=null;
    sorted.forEach(function(s){
      var n=(s.porteroName && s.porteroName!=='Sin portero')?s.porteroName:lastOwner;
      owners.push(n); if(n) lastOwner=n;
    });
    var firstOwner=null;
    for(var oi=0;oi<owners.length;oi++){ if(owners[oi]){ firstOwner=owners[oi]; break; } }
    for(var oj=0;oj<owners.length && !owners[oj];oj++) owners[oj]=firstOwner;
    onCourt=[false];
    owners.forEach(function(n){ onCourt.push(n===filterPortero); });
    onCourt.push(onCourt[onCourt.length-1]);
    var ig=0, ip=0, started=false;
    var indPct=steps.map(function(){return null;});
    for(var ii=1;ii<=sorted.length;ii++){
      var sh=sorted[ii-1];
      if(owners[ii-1]===filterPortero){
        if(sh.result==='parada') ip++;
        else if((sh.result==='gol'||sh.result==='sinportero') && !sh.noGk) ig++;
      }
      if(onCourt[ii] && !started){ started=true; indPct[ii-1]=0; }
      if(started) indPct[ii]=(ig+ip)>0?Math.round(ip/(ig+ip)*100):0;
    }
    indPct[sorted.length+1]=indPct[sorted.length];
    cumPct=indPct;
  }
  var maxVal=Math.max(1,g,p);
  var validPct=cumPct.filter(function(v){return v!==null;});
  var rawMin=validPct.length?Math.min.apply(null,validPct):0;
  var rawMax=validPct.length?Math.max.apply(null,validPct):100;
  var PCT_MIN=Math.max(0, Math.floor((rawMin-10)/10)*10);
  var PCT_MAX=Math.min(100, Math.ceil((rawMax+10)/10)*10);
  if(PCT_MAX-PCT_MIN<20){PCT_MIN=Math.max(0,PCT_MIN-10);PCT_MAX=Math.min(100,PCT_MAX+10);}
  function sx(t){ return PAD.l+t*(cw/totalMins); } // t in fractional minutes
  function sxI(i){ return PAD.l+steps[i].t*(cw/totalMins); } // by index
  function syVal(v,mx){ return PAD.t+ch-(v/mx)*ch; }
  function syPct(v){ if(v===null) return null; var clamped=Math.min(PCT_MAX,Math.max(PCT_MIN,v)); return PAD.t+ch-((clamped-PCT_MIN)/(PCT_MAX-PCT_MIN))*ch; }

  // Bandas de valoración (mismos umbrales que el resumen de temporada), solo dentro del
  // rango de % actualmente visible en el eje.
  if(timelineShow.pct){
    var RATING_BANDS=[
      {from:40,to:100,label:'EXCEPCIONAL',color:'#6366f1'},
      {from:35,to:40, label:'MUY BUENA',  color:'#38bdf8'},
      {from:30,to:35, label:'BUENA',      color:'#16a34a'},
      {from:25,to:30, label:'CORRECTA',   color:'#86efac'},
      {from:20,to:25, label:'MEJORABLE',  color:'#fb923c'},
      {from:0, to:20, label:'MALA',       color:'#ef4444'}
    ];
    RATING_BANDS.forEach(function(b){
      var top=Math.min(b.to,PCT_MAX), bottom=Math.max(b.from,PCT_MIN);
      if(top<=bottom) return; // sin solape con el rango visible
      var y1=syPct(top), y2=syPct(bottom);
      ctx.fillStyle=b.color+'1a'; // ~10% de opacidad
      ctx.fillRect(PAD.l,y1,cw,y2-y1);
      if(y2-y1>=13){
        ctx.save();
        ctx.font='9px DM Sans,sans-serif'; ctx.fillStyle=b.color+'99';
        ctx.textAlign='left'; ctx.textBaseline='middle';
        ctx.fillText(b.label, PAD.l+4, (y1+y2)/2);
        ctx.restore();
      }
    });
  }

  // Grid lines
  ctx.strokeStyle='rgba(255,255,255,.06)'; ctx.lineWidth=1;
  for(var gi=0;gi<=4;gi++){
    var y=PAD.t+gi*(ch/4);
    ctx.beginPath(); ctx.moveTo(PAD.l,y); ctx.lineTo(PAD.l+cw,y); ctx.stroke();
  }

  // X axis labels (every 5 min) — sx(m) takes fractional minutes directly
  ctx.fillStyle='rgba(255,255,255,.35)'; ctx.font='10px DM Sans,sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='top';
  for(var m=0;m<=totalMins;m++){
    if(m%5===0||m===totalMins){
      ctx.fillText(m+"'", sx(m), PAD.t+ch+6);
    }
  }

  // Y axis labels (left = %) — mismos límites que la leyenda de valoración, solo los que
  // caen dentro del rango visible actual.
  ctx.textBaseline='middle';
  if(timelineShow.pct){
    ctx.textAlign='right'; ctx.fillStyle='rgba(59,130,246,.5)';
    [50,40,35,30,25,20].forEach(function(v){
      if(v<PCT_MIN||v>PCT_MAX) return;
      ctx.fillText(v+'%', PAD.l-6, syPct(v));
    });
  }
  function drawLine(data, colorHex, usePct){
    ctx.beginPath(); ctx.strokeStyle=colorHex; ctx.lineWidth=2.5;
    ctx.lineJoin='round'; ctx.lineCap='round';
    var started=false;
    data.forEach(function(v,i){
      if(v===null) return;
      var x=sxI(i), y=usePct?syPct(v):syVal(v,maxVal);
      if(!started){ ctx.moveTo(x,y); started=true; } else ctx.lineTo(x,y);
    });
    ctx.stroke();
    if(onCourt){
      ctx.save(); ctx.strokeStyle=colorHex; ctx.lineWidth=6; ctx.lineCap='round'; ctx.lineJoin='round';
      for(var oi2=1;oi2<data.length;oi2++){
        if(!onCourt[oi2] || data[oi2]===null || data[oi2-1]===null) continue;
        ctx.beginPath();
        ctx.moveTo(sxI(oi2-1), usePct?syPct(data[oi2-1]):syVal(data[oi2-1],maxVal));
        ctx.lineTo(sxI(oi2),   usePct?syPct(data[oi2]):syVal(data[oi2],maxVal));
        ctx.stroke();
      }
      ctx.restore();
    }
    data.forEach(function(v,i){
      if(v===null) return;
      var x=sxI(i), y=usePct?syPct(v):syVal(v,maxVal);
      ctx.beginPath(); ctx.arc(x,y,3,0,2*Math.PI);
      ctx.fillStyle=colorHex; ctx.fill();
    });
  }

  if(timelineShow.gol)    drawLine(cumGol,  '#ef4444', false);
  if(timelineShow.parada) drawLine(cumPar,  '#22c55e', false);
  if(timelineShow.pct)    drawLine(cumPct,  '#3b82f6', true);

  // Valor final de cada línea, justo al lado de su último punto (más claro que un eje compartido)
  function labelEnd(data, colorHex, usePct, suffix){
    var lastIdx=-1;
    for(var i=data.length-1;i>=0;i--){ if(data[i]!==null){ lastIdx=i; break; } }
    if(lastIdx<0) return;
    var x=sxI(lastIdx), y=usePct?syPct(data[lastIdx]):syVal(data[lastIdx],maxVal);
    ctx.save();
    ctx.font='bold 11px DM Sans,sans-serif'; ctx.fillStyle=colorHex;
    ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(data[lastIdx]+(suffix||''), x+6, y);
    ctx.restore();
  }
  if(timelineShow.gol)    labelEnd(cumGol,  '#ef4444', false);
  if(timelineShow.parada) labelEnd(cumPar,  '#22c55e', false);
  if(timelineShow.pct)    labelEnd(cumPct,  '#3b82f6', true, '%');

  // Filtro por parte (2026-09-21): no recorta la gráfica, oscurece la parte NO elegida y marca
  // el descanso (minuto 30) con una línea discontinua.
  if(filterHalf!=='all'){
    var x30=Math.min(PAD.l+cw, Math.max(PAD.l, sx(30)));
    ctx.save();
    ctx.fillStyle='rgba(5,10,20,.62)';
    if(filterHalf===1) ctx.fillRect(x30, PAD.t, PAD.l+cw-x30, ch);
    else               ctx.fillRect(PAD.l, PAD.t, x30-PAD.l, ch);
    ctx.setLineDash([5,4]); ctx.strokeStyle='rgba(255,255,255,.5)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(x30,PAD.t); ctx.lineTo(x30,PAD.t+ch); ctx.stroke();
    ctx.restore();
  }

  // ── Shot markers: draw individual dots when any filter active ───────────
  var hasFilter = filterPlayer!=='all' || statsTrajFilter || statsGoalPosFilter || statsZoneFilter || statsHabFilter;
  if(hasFilter){
    var gm2={'9m total':['Lateral izq','Central','Lateral der'],
             '6m total':['6m izq','6m cent','6m der'],
             'Extremos':['Extremo izq','Extremo der']};
    var markerShots = sorted.filter(function(s){
      if(statsZoneFilter){
        var gz=gm2[statsZoneFilter]||[statsZoneFilter];
        if(gz.indexOf(s.zone)<0) return false;
      }
      if(statsGoalPosFilter && s.goalPos!==statsGoalPosFilter) return false;
      if(statsTrajFilter     && s.traj!==statsTrajFilter) return false;
      if(statsHabFilter      && !s.hab) return false;
      if(filterPlayer!=='all' && s.attackerId!==filterPlayer) return false;
      return true;
    });
    // Find cumulative count at each shot's exact step position and draw marker ON the line
    markerShots.forEach(function(s){
      var t=timeToSec(s.time)/60;
      var mx=sx(t);
      if(mx<PAD.l||mx>PAD.l+cw) return;
      // Find the step index AFTER this shot (where cumulative value has already jumped)
      var stepIdx=steps.findIndex(function(st,i){
        return st.t===t && (i===0 || steps[i-1].t===t);
      });
      // Find last step at this time (after the increment)
      var lastAtT=-1;
      for(var si=0;si<steps.length;si++){
        if(Math.abs(steps[si].t-t)<0.001) lastAtT=si;
      }
      if(lastAtT<0) return;
      var isGol=s.result==='gol'||s.result==='sinportero';
      var isPar=s.result==='parada';
      var col=isPar?'#22c55e':isGol?'#ef4444':'#64748b';
      // Y position: on the gol or parada line
      var lineVal = isPar ? steps[lastAtT].p : (isGol ? steps[lastAtT].g : null);
      if(lineVal===null) return;
      var my = syVal(lineVal, maxVal);
      ctx.save();
      ctx.beginPath(); ctx.arc(mx, my, 6, 0, 2*Math.PI);
      ctx.fillStyle=col; ctx.fill();
      ctx.strokeStyle='white'; ctx.lineWidth=2; ctx.stroke();
      ctx.restore();
    });
  }

  // Store data for click handler
  cv._tlData = {sorted:sorted, PAD:PAD, cw:cw, ch:ch, totalMins:totalMins,
    cumGol:cumGol, cumPar:cumPar, cumPct:cumPct, ownGoals:(ownGoals||[]).slice(),
    sx:sx, syPct:syPct, PCT_MIN:PCT_MIN, PCT_MAX:PCT_MAX,
    steps:steps, maxVal:maxVal, syVal:syVal};
  // Attach click only once
  if(!cv._tlClick){
    cv._tlClick = true;
    cv.style.cursor = 'crosshair';
    cv.addEventListener('click', function(e){
      var d = cv._tlData; if(!d) return;
      var rect = cv.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      // 2026-09-21: solo son seleccionables los PUNTOS de las líneas de goles y paradas (las
      // acciones en nuestra portería) que estén visibles — un clic en cualquier otro sitio
      // no muestra nada, ni siquiera los goles propios (ya salen en el marcador de cada evento).
      var nearest = null, nearestDist = 30, nearestIsOwnGoal = false; // 30px de tolerancia (táctil; con 16 se fallaba casi siempre en la tablet)
      d.sorted.forEach(function(s, i){
        var isGol = (s.result==='gol'||s.result==='sinportero');
        var isPar = (s.result==='parada');
        if(!isGol && !isPar) return;
        if(isGol && !timelineShow.gol) return;
        if(isPar && !timelineShow.parada) return;
        var st = d.steps[i+1]; if(!st) return;
        var px = d.sx(timeToSec(s.time)/60), py = d.syVal(isGol?st.g:st.p, d.maxVal);
        var dist = Math.sqrt((mx-px)*(mx-px)+(my-py)*(my-py));
        if(dist <= nearestDist){ nearestDist=dist; nearest=s; }
      });
      if(!nearest) return;
      var nearestSec = timeToSec(nearest.time);
      // Reconstruct the real scoreboard (us vs rival) at this moment
      var scoreUsAt=0, scoreRivalAt=0;
      d.sorted.forEach(function(s){
        if(timeToSec(s.time)>nearestSec) return;
        if(s.result==='gol'||s.result==='sinportero') scoreRivalAt++;
      });
      (d.ownGoals||[]).forEach(function(og){
        if(timeToSec(og.time)<=nearestSec) scoreUsAt++;
      });
      var icon, resultLabel;
      if(nearestIsOwnGoal){
        icon = '⚽';
        resultLabel = 'GOL PROPIO';
      } else {
        icon = nearest.result==='parada'?'🧤':nearest.result==='gol'||nearest.result==='sinportero'?'⚽':'↗';
        resultLabel = nearest.result.toUpperCase() + (nearest.noGk?' · SIN PORTERO':'');
      }
      var parts = [
        icon + ' Min ' + nearest.time + '   ' + scoreUsAt + ' - ' + scoreRivalAt,
        resultLabel
      ];
      if(!nearestIsOwnGoal){
        // xGOT solo tiene sentido para tiros que fueron a puerta de verdad (no 'fuera', no
        // portería vacía) — si no, para un 'fuera' con una localización antigua guardada
        // dentro de la portería (antes de que existieran las 9 zonas "Fuera", ver regla 22)
        // se mostraría un xGOT inventado para un tiro que ni siquiera llegó a puerta.
        var nXg=calcularXG(nearest), nXgot=(nearest.result!=='fuera'&&!nearest.noGk)?calcularXGOT(nearest.goalPos,nearest.zone):null;
        parts = parts.concat([
          nearest.porteroName ? 'Portera: ' + nearest.porteroName : '',
          nearest.zone        ? 'Zona: ' + nearest.zone : '',
          nearest.goalPos     ? 'Posición: ' + nearest.goalPos : '',
          nearest.attacker    ? 'Atacante: ' + nearest.attacker : '',
          nearest.hab         ? '✨ Con habilidad' : '',
          nearest.traj        ? (nearest.traj==='cruzado'?'✕ Cruzado':'‖ Paralelo') : '',
          (nXg!==null||nXgot!==null) ? ('xG: '+(nXg!==null?nXg:'—')+'  xGOT: '+(nXgot!==null?nXgot:'—')) : ''
        ]);
        // Racha del portero en ese momento (2026-09-21): mismos criterios que la tarjeta del
        // portero (rachaPortero: 'fuera' y sin portero ni cuentan ni cortan), pero solo con
        // lo ocurrido hasta este lanzamiento incluido, y de la portera que lo recibió.
        var nIdx=d.sorted.indexOf(nearest);
        var rachaHasta=d.sorted.slice(0, nIdx>=0?nIdx+1:d.sorted.length).filter(function(s){
          return !nearest.porteroName || nearest.porteroName==='Sin portero' || s.porteroName===nearest.porteroName;
        });
        var rc=rachaPortero(rachaHasta);
        if(rc){
          parts.push((rc.tipo==='parada'?'🟢 Racha: ':'🔴 Racha: ') + rc.count + ' ' +
            (rc.tipo==='parada' ? (rc.count===1?'parada':'paradas seguidas') : (rc.count===1?'gol':'goles seguidos')));
        }
      }
      alert(parts.filter(Boolean).join(String.fromCharCode(10)));
    });
  }
}
var activePorteroId = null, porteroPhotoTarget = null;
// Limpieza de listeners de arrastre de foto por portero: renderPorteros() reconstruye
// la tarjeta (y por tanto el elemento) en cada render, así que un guard tipo
// `el._dragAttached` nunca sirve para deduplicar — hay que desengachar explícitamente
// los listeners de la llamada anterior antes de engachar los nuevos.
var _dragCleanupByPid = {};
var porteros = [
  {id:1,name:'Portero 1',dorsal:'',photo:null,seconds:0,ox:50,oy:20},
  {id:2,name:'Portero 2',dorsal:'',photo:null,seconds:0,ox:50,oy:20}
];
var nextPid = 3, attackers = [], selectedAttacker = null;
// ===== MODO 2 EQUIPOS DE PORTEROS =====
// dosEquipos: hay dos porteros jugando a la vez, uno por equipo (porteros[].team = 1|2, sin campo = 1).
// activePorteroId es el portero en juego del Equipo 1; activePorteroId2 el del Equipo 2.
// equipoRecibe (1|2): equipo cuyo portero recibe el SIGUIENTE lanzamiento; tras registrar uno pasa
// solo al otro equipo, y se puede cambiar a mano pulsando un portero. Los lanzadores (attackers[].team)
// son los del equipo CONTRARIO al que recibe (sin campo team = 2, el "rival" de siempre).
var dosEquipos = false, activePorteroId2 = null, equipoRecibe = 1, teamNames = ['Equipo 1','Equipo 2'];
function porteroTeam(pid){ var p=porteros.find(function(x){return x.id===pid;}); return p&&p.team===2?2:1; }
function teamPorteros(t){ return porteros.filter(function(p){return (p.team===2?2:1)===t;}); }
function activePidOf(t){ return t===2?activePorteroId2:activePorteroId; }
function receivingPid(){ return (dosEquipos&&equipoRecibe===2)?activePorteroId2:activePorteroId; }
function shooterTeam(){ return dosEquipos?(equipoRecibe===1?2:1):2; }
function attackerVisible(a){ return !dosEquipos||(a.team===1?1:2)===shooterTeam(); }
// Equipo del portero que recibió el tiro (portería vacía: se guardó en gkTeam al registrarlo)
function shotGkTeam(s){ return s.porteroId!=null?porteroTeam(s.porteroId):(s.gkTeam===2?2:1); }
var selectedZone = null, selectedGoalPos = null, selectedResult = null;
var shots = [], ownGoals = [], filterPortero = 'all', filterPlayer  = 'all', filterHalf = 'all', selectedPfPd = null, selectedHab = false, selectedTraj = null, selectedNoGk = false, selectedDeflected = false, selectedRebote = false, statsTrajFilter = null, statsZoneFilter = null, statsGoalPosFilter = null, statsHabFilter = false;
var otrasContribs = []; // [{id,time,key,porteroId,porteroName}]
var OFENSIVA_DEFS = [
  {key:'asistencia',   label:'Asistencia',            icon:'🤝'},
  {key:'oleada',       label:'2ª Oleada Exitosa',      icon:'🔄'},
  {key:'contragol',    label:'Contragol Exitoso',      icon:'⚡'},
  {key:'paseFallado',  label:'Pase Fallado',           icon:'❌'},
  {key:'gpg',          label:'Gol Port. a Port.',      icon:'🥅'},
  {key:'gpgFallo',     label:'Fallo Port. a Port.',    icon:'🚫'},
  {key:'recuperacion', label:'Recuperación',           icon:'🛡️'}
];
var currentMatchId = null, currentMatchDate = null, explorerFolder = null;

// ===== MODELO xG / xGOT / GSAx (portero) =====
// Adaptado de Handball Stats Pro a los campos de esta app (spec del 2026-09-11).
// xGOT = 1 - xSave por construcción: son complementarios, no dos medidas independientes.
var XG_BASE_BY_TYPE = { '7M':0.74, 'Counter':0.80, 'Break':0.72, 'Wing':0.64, 'Long':0.45 };
// xGOT por TIPO de lanzamiento y zona de portería (2026-09-25, ver reglas 74/75 de
// CONTEXTO_PROYECTO.md para la discusión completa y los criterios de recalibración).
// Sustituye al antiguo XGOT_ZONA de solo-destino (era un simple "coeficiente de destino":
// dos lanzamientos con el mismo destino recibían el mismo valor sin importar de dónde
// vinieran). Tabla y método (suavizado m-estimate, m=15, elegido minimizando Brier con
// validación cruzada de 5 particiones) calibrados por un tercero sobre 5.796 tiros a puerta
// reales de 73 partidos (balonmano masculino y femenino, de élite a juvenil). Se adoptan TAL
// CUAL, sin recalibrar con datos propios todavía — la mezcla de categorías/niveles de esta
// app (regla 74) hace arriesgado mezclar ambas fuentes hasta tener mucha más muestra propia.
var XGOT_TIPO_ZONA = {
  '7M':      {'Alto izq':0.84,'Alto centro':0.56,'Alto der':0.87,'Medio izq':0.68,'Centro':0.32,'Medio der':0.68,'Bajo izq':0.92,'Bajo centro':0.77,'Bajo der':0.88},
  'Counter': {'Alto izq':0.89,'Alto centro':0.64,'Alto der':0.82,'Medio izq':0.73,'Centro':0.43,'Medio der':0.76,'Bajo izq':0.88,'Bajo centro':0.92,'Bajo der':0.91},
  'Break':   {'Alto izq':0.77,'Alto centro':0.60,'Alto der':0.87,'Medio izq':0.72,'Centro':0.13,'Medio der':0.75,'Bajo izq':0.91,'Bajo centro':0.77,'Bajo der':0.88},
  // 'Pivot' no lo usa ningún tiro de esta app hoy — 'zone' nunca resuelve a este tipo (ver
  // XG_ZONE_TO_TYPE, regla ya confirmada de que 6m se trata como Break, no Pivot). Se deja
  // en la tabla completa, sin usar, por si algún día se añade una zona propia de pivote.
  'Pivot':   {'Alto izq':0.81,'Alto centro':0.68,'Alto der':0.82,'Medio izq':0.69,'Centro':0.45,'Medio der':0.80,'Bajo izq':0.89,'Bajo centro':0.80,'Bajo der':0.89},
  'Wing':    {'Alto izq':0.77,'Alto centro':0.45,'Alto der':0.78,'Medio izq':0.65,'Centro':0.17,'Medio der':0.59,'Bajo izq':0.86,'Bajo centro':0.74,'Bajo der':0.81},
  'Long':    {'Alto izq':0.74,'Alto centro':0.40,'Alto der':0.75,'Medio izq':0.58,'Centro':0.16,'Medio der':0.57,'Bajo izq':0.77,'Bajo centro':0.55,'Bajo der':0.75}
};
// Respaldo cuando no se conoce (o no se reconoce) el tipo de lanzamiento — mismo origen y
// misma calibración que XGOT_TIPO_ZONA, ya no son los valores propios que tenía antes esta
// app en solitario.
var XGOT_ZONA = {
  'Alto izq':0.80,  'Alto centro':0.56,  'Alto der':0.81,
  'Medio izq':0.68, 'Centro':0.26,       'Medio der':0.71,
  'Bajo izq':0.87,  'Bajo centro':0.77,  'Bajo der':0.85
};
// Solo Wing/Break (cerca) y Lateral/Central (9m, lejos) tienen lado izq/centro/der en esta
// app; '7 metros' y 'Contraataque' son valores únicos de 'zone' sin variante de lado, así
// que no llevan modificador — su xG base ya representa la situación completa.
var XG_ZONE_MODIFIERS = {
  leftNear:1.05, centerNear:1.15, rightNear:1.05,
  leftFar:0.85,  centerFar:0.90,  rightFar:0.85
};
// '6m izq/cent/der' se trata como Break (penetración), no Pivot: esta app no tiene una
// zona propia para pivote, decisión confirmada con el usuario al portar el modelo.
var XG_ZONE_TO_TYPE = {
  'Extremo izq': {type:'Wing',  mod:'leftNear'},
  'Extremo der': {type:'Wing',  mod:'rightNear'},
  '6m izq':      {type:'Break', mod:'leftNear'},
  '6m cent':     {type:'Break', mod:'centerNear'},
  '6m der':      {type:'Break', mod:'rightNear'},
  'Lateral izq': {type:'Long',  mod:'leftFar'},
  'Central':     {type:'Long',  mod:'centerFar'},
  'Lateral der': {type:'Long',  mod:'rightFar'},
  '7 metros':    {type:'7M',    mod:null},
  'Contraataque':{type:'Counter', mod:null}
};
var XG_RANGE = { MIN:0.01, MAX:0.98 };
var XG_EMPTY_NET = 0.90;
var XG_TIME_MODIFIERS = { FINAL_5_MIN:1.05, FINAL_10_MIN:1.03 };
// Esta app no guarda la duración del partido; se asume sénior (60') salvo que se indique otra.
var XG_DEFAULT_MATCH_DURATION = 60;

function _xgMinuto(time){
  var m = /^(\d+):(\d{2})$/.exec(String(time||''));
  return m ? parseInt(m[1],10) : null;
}

// xG de un lanzamiento. null si no es un lanzamiento del universo del modelo o si falta
// el campo 'zone' — nunca se inventa un tipo por defecto.
function calcularXG(shot, opts){
  if(!shot || (shot.result!=='gol' && shot.result!=='parada' && shot.result!=='fuera')) return null;
  var matchDuration = (opts && opts.matchDuration) || XG_DEFAULT_MATCH_DURATION;
  var info = shot.zone ? XG_ZONE_TO_TYPE[shot.zone] : null;
  if(!info) return null;

  var xg = XG_BASE_BY_TYPE[info.type];
  if(info.mod) xg *= XG_ZONE_MODIFIERS[info.mod];

  var minuto = _xgMinuto(shot.time);
  if(minuto!==null){
    if(minuto >= matchDuration-5) xg *= XG_TIME_MODIFIERS.FINAL_5_MIN;
    else if(minuto >= matchDuration-10) xg *= XG_TIME_MODIFIERS.FINAL_10_MIN;
  }

  // Portería vacía (gol sin portero, o legado 'sinportero'): suelo alto, no multiplicador.
  if(shot.noGk || shot.result==='sinportero') xg = Math.max(xg, XG_EMPTY_NET);

  return Math.round(Math.min(Math.max(xg, XG_RANGE.MIN), XG_RANGE.MAX) * 1000) / 1000;
}

// ¿Fue a puerta? Solo gol o parada (incluye el legado 'sinportero' como gol). 'fuera' NUNCA
// cuenta como tiro a puerta — es la definición que hace que el save% y el GSAx signifiquen algo.
function esTiroAPuerta(shot){
  return !!shot && (shot.result==='gol' || shot.result==='parada' || shot.result==='sinportero');
}

// xGOT depende de la zona de portería (obligatorio) y, si se conoce, del tipo de lanzamiento
// (derivado de 'zone' vía XG_ZONE_TO_TYPE, el mismo mapeo que ya usa calcularXG — nunca
// diverge porque es la misma tabla). null si falta goalPos o no es una zona reconocida: nunca
// se infiere. Si el tipo no se conoce/reconoce, cae al respaldo de solo-zona (XGOT_ZONA) —
// mismo comportamiento que calcularXGOT tenía antes de la regla 74/75.
function calcularXGOT(goalPos, zone){
  var v = XGOT_ZONA[goalPos];
  if(v===undefined) return null;
  var info = zone ? XG_ZONE_TO_TYPE[zone] : null;
  var tipo = info ? info.type : null;
  var fila = tipo && XGOT_TIPO_ZONA[tipo];
  return (fila && fila[goalPos]!==undefined) ? fila[goalPos] : v;
}

/**
 * GSAx = (suma del xGOT de los tiros recibidos) − (goles encajados), sobre el mismo
 * subconjunto de tiros en ambos lados de la resta (los que sí tienen goalPos registrado).
 * Excluye portería vacía (noGk / 'sinportero'): no hay portero al que atribuírselo.
 * Positivo = paró más de lo esperado; negativo = menos.
 */
function calcularGSAx(shotsArr, porteroId){
  var recibidos = (shotsArr||[]).filter(function(s){
    return esTiroAPuerta(s) && !s.noGk && s.result!=='sinportero' &&
      (porteroId==null || s.porteroId===porteroId);
  });
  var conDato = recibidos.filter(function(s){ return calcularXGOT(s.goalPos,s.zone)!==null; });
  var goles = conDato.filter(function(s){ return s.result==='gol'; }).length;
  var paradas = conDato.length - goles;
  var xgotTotal = conDato.reduce(function(sum,s){ return sum + calcularXGOT(s.goalPos,s.zone); }, 0);
  return {
    tiros: recibidos.length,
    tirosConDato: conDato.length,
    paradas: paradas,
    goles: goles,
    savePct: conDato.length ? Math.round(paradas/conDato.length*1000)/10 : null,
    xGOTRecibido: Math.round(xgotTotal*100)/100,
    gsax: conDato.length ? Math.round((xgotTotal-goles)*100)/100 : null
  };
}

// Mismo balance que calcularGSAx pero por colocación: responde "¿paró de más o de menos
// en cada parte de la portería?". Puede divergir del GSAx global a propósito.
function gsaxPorZona(shotsArr, porteroId){
  var ZONAS = ['Alto izq','Alto centro','Alto der','Medio izq','Centro','Medio der','Bajo izq','Bajo centro','Bajo der'];
  var recibidos = (shotsArr||[]).filter(function(s){
    return esTiroAPuerta(s) && !s.noGk && s.result!=='sinportero' &&
      (porteroId==null || s.porteroId===porteroId) && s.goalPos;
  });
  var porZona = {};
  ZONAS.forEach(function(z){
    var enZona = recibidos.filter(function(s){ return s.goalPos===z; });
    var tiros = enZona.length;
    var paradas = enZona.filter(function(s){ return s.result!=='gol'; }).length;
    // Ahora tiene en cuenta el tipo de lanzamiento de CADA tiro (regla 74/75), no un único
    // valor de zona para todo el grupo: suma la xGOT individual de cada tiro en vez de
    // tiros*XGOT_ZONA[z] a secas.
    var esperadas = Math.round(enZona.reduce(function(sum,s){ return sum+(1-calcularXGOT(z,s.zone)); },0)*100)/100;
    porZona[z] = {
      tiros:tiros, paradas:paradas, esperadas:esperadas,
      pct: tiros ? Math.round(paradas/tiros*100) : null,
      diferencia: Math.round((paradas-esperadas)*100)/100
    };
  });
  var total = Math.round(ZONAS.reduce(function(a,z){ return a+porZona[z].diferencia; },0)*100)/100;
  return { porZona:porZona, gsaxZonal:total };
}

// xG total del equipo rival sobre un conjunto de tiros (para el panel "Global" del partido).
function xgTotalEquipo(shotsArr, opts){
  var vals = (shotsArr||[]).map(function(s){ return calcularXG(s, opts); }).filter(function(v){ return v!==null; });
  return {
    xg: Math.round(vals.reduce(function(a,b){ return a+b; }, 0)*100)/100,
    conDato: vals.length,
    total: (shotsArr||[]).length
  };
}

// La ventana de resumen de temporada es un documento aparte (sin acceso al scope de
// arriba): en vez de retipear estas funciones ahí dentro (la trampa que ya costó una
// sesión entera con sGroupRow/buildZoneRows, regla 1 de CONTEXTO_PROYECTO.md), se
// serializa el código REAL de estas funciones vía toString() y se inyecta tal cual en
// el <script> de esa ventana — nunca puede divergir porque es literalmente el mismo texto.
var XG_MODEL_SRC = [_xgMinuto, calcularXG, esTiroAPuerta, calcularXGOT, calcularGSAx, gsaxPorZona, xgTotalEquipo]
  .map(function(f){ return f.toString(); }).join('\n')
  + '\nvar XG_BASE_BY_TYPE=' + JSON.stringify(XG_BASE_BY_TYPE) + ';'
  + '\nvar XGOT_ZONA=' + JSON.stringify(XGOT_ZONA) + ';'
  + '\nvar XGOT_TIPO_ZONA=' + JSON.stringify(XGOT_TIPO_ZONA) + ';'
  + '\nvar XG_ZONE_MODIFIERS=' + JSON.stringify(XG_ZONE_MODIFIERS) + ';'
  + '\nvar XG_ZONE_TO_TYPE=' + JSON.stringify(XG_ZONE_TO_TYPE) + ';'
  + '\nvar XG_RANGE=' + JSON.stringify(XG_RANGE) + ';'
  + '\nvar XG_EMPTY_NET=' + XG_EMPTY_NET + ';'
  + '\nvar XG_TIME_MODIFIERS=' + JSON.stringify(XG_TIME_MODIFIERS) + ';'
  + '\nvar XG_DEFAULT_MATCH_DURATION=' + XG_DEFAULT_MATCH_DURATION + ';';

// ===== FILESYSTEM =====
// ===== STORAGE: IndexedDB with in-memory cache =====
var _fsCache = {folders:[], files:[]};
var _idb = null;
var _idbReady = false;

function _openIDB(cb){
  if(_idb){ cb(_idb); return; }
  var req = indexedDB.open('hb_store', 1);
  req.onupgradeneeded = function(e){
    var db = e.target.result;
    if(!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
  };
  req.onsuccess = function(e){ _idb = e.target.result; cb(_idb); };
  req.onerror = function(){ cb(null); };
}

function _idbGet(key, cb){
  _openIDB(function(db){
    if(!db){ cb(null); return; }
    try{
      var tx = db.transaction('kv','readonly');
      var req = tx.objectStore('kv').get(key);
      req.onsuccess = function(){ cb(req.result||null); };
      req.onerror   = function(){ cb(null); };
    }catch(e){ cb(null); }
  });
}

function _idbSet(key, value){
  _openIDB(function(db){
    if(!db){ return; }
    try{
      var tx = db.transaction('kv','readwrite');
      tx.objectStore('kv').put(value, key);
    }catch(e){ console.error('IDB write error:', e); }
  });
}

// Call once at startup — loads data into cache, migrates from localStorage if needed
function initStorage(done){
  _idbGet('hb_fs6', function(val){
    if(val){
      _fsCache = (typeof val==='string') ? JSON.parse(val) : val;
    } else {
      // Try migrating from localStorage
      var lsVal = null;
      try{ lsVal = localStorage.getItem('hb_fs6'); }catch(e){}
      if(lsVal){
        try{ _fsCache = JSON.parse(lsVal); }catch(e){ _fsCache={folders:[],files:[]}; }
        _idbSet('hb_fs6', _fsCache);
        try{ localStorage.removeItem('hb_fs6'); }catch(e){}
        console.log('Migrated hb_fs6 from localStorage to IndexedDB');
      }
    }
    // Also load photo store, then migrate inline photos out of match files
    loadPhotos(function(){
      loadTeamPhotos(function(){
        loadLogos(function(){
          loadFileTsCache(function(){
            loadPhotoTs(function(){
              _migrateInlinePhotos();
              _migrateOldTrashFormat();
              _idbReady = true;
              done();
            });
          });
        });
      });
    });
  });
}

// Migración única (2026-09-20): antes "Eliminar" sacaba el partido/carpeta a un array
// fsData.trash aparte, solo local (ver la regla de la papelera sincronizada). Se convierte
// aquí al nuevo modelo (trashedAt/trashId/stateTs directamente en el propio partido/carpeta,
// que se queda en fsData.files/folders) para no perder lo que ya hubiera en la papelera de
// este dispositivo, y para que a partir de ahora viaje por el mismo canal de sincronización
// que el resto del contenido.
function _migrateOldTrashFormat(){
  var oldTrash = _fsCache.trash;
  if(!oldTrash || !oldTrash.length) return;
  var fileIndexById = {}; (_fsCache.files||[]).forEach(function(f,i){ fileIndexById[f.id]=i; });
  var folderIndexById = {}; (_fsCache.folders||[]).forEach(function(f,i){ folderIndexById[f.id]=i; });
  function upsertFile(file, trashId, isRoot){
    file = Object.assign({}, file, {trashedAt:file.trashedAt||Date.now(), trashId:trashId, stateTs:Date.now(), isTrashRoot:!!isRoot});
    if(file.id in fileIndexById) _fsCache.files[fileIndexById[file.id]] = file;
    else { fileIndexById[file.id] = _fsCache.files.length; _fsCache.files.push(file); }
  }
  function upsertFolder(folder, trashId, isRoot){
    folder = Object.assign({}, folder, {trashedAt:folder.trashedAt||Date.now(), trashId:trashId, stateTs:Date.now(), isTrashRoot:!!isRoot});
    if(folder.id in folderIndexById) _fsCache.folders[folderIndexById[folder.id]] = folder;
    else { folderIndexById[folder.id] = _fsCache.folders.length; _fsCache.folders.push(folder); }
  }
  oldTrash.forEach(function(entry){
    var trashId = entry.id || _trashId();
    if(entry.type==='file' && entry.data && entry.data.file){
      upsertFile(entry.data.file, trashId, true);
    } else if(entry.type==='folder' && entry.data){
      if(entry.data.folder) upsertFolder(entry.data.folder, trashId, true);
      (entry.data.folders||[]).forEach(function(f){ upsertFolder(f, trashId, false); });
      (entry.data.files||[]).forEach(function(f){ upsertFile(f, trashId, false); });
    }
  });
  delete _fsCache.trash;
  _idbSet('hb_fs6', _fsCache);
  console.log('Migrated old local-only trash to synced trashedAt format');
}

// One-time migration: move inline photos from old saved matches into photo store
function _migrateInlinePhotos(){
  var changed = false;
  var tsChanged = false;
  (_fsCache.files||[]).forEach(function(file){
    var d = file.data;
    if(!d) return;
    (d.porteros||[]).forEach(function(p){
      if(p.photo && p.name){
        // Save to photo store if not already there
        if(!_photoCache[p.name]) _photoCache[p.name] = p.photo;
        // Strip from match data to save space
        p.photo = null;
        changed = true;
      }
    });
    // Migración 2026-09-18: escudos de rival embebidos a tamaño completo dentro de cada
    // partido (hasta ~700KB cada uno, repetidos una vez por partido jugado contra ese
    // rival — comprobado en la nube real: 11 de 67 partidos, 3.5MB solo en duplicados) se
    // mueven al mismo tipo de caché compartida por nombre (_logoCache, ver saveRivalLogo).
    var rivalName = (d.rival||'').trim();
    if(d.logoData && rivalName){
      if(!_logoCache[rivalName]) _logoCache[rivalName] = d.logoData;
      d.logoData = null;
      changed = true;
      // El contenido de este partido acaba de cambiar (ya no lleva el escudo embebido):
      // invalida su marca de "confirmado sincronizado" para que la próxima subida
      // (incremental o "Sincronizar ahora") vuelva a subirlo, esta vez sin el escudo
      // duplicado — así se reduce también lo que hay guardado en la nube, no solo en local.
      if(file.id in _fileTsCache){ delete _fileTsCache[file.id]; tsChanged = true; }
    }
  });
  if(changed){
    _idbSet('hb_photos', _photoCache);
    _idbSet('hb_logos', _logoCache);
    _idbSet('hb_fs6', _fsCache);
    console.log('Migrated inline photos/logos to shared photo store');
  }
  if(tsChanged) _idbSet('hb_file_ts', _fileTsCache);
}

function loadFS(){
  return _fsCache;
}

function openMatchFromRivals(fileId){
  // Close any overlays (rivals, season)
  var ro = document.getElementById('rivals-overlay');
  var so = document.getElementById('season-overlay');
  if(ro) ro.remove();
  if(so) so.remove();
  // Load the match and show stats section
  var fs = loadFS();
  var file = fs.files.find(function(f){ return f.id === fileId; });
  if(!file){ notify('Partido no encontrado', true); return; }
  // Load the match data
  if(file.data){
    shots = file.data.shots || [];
    currentMatchId = file.id;
    if(file.data.rival) document.getElementById('rival-name').value = file.data.rival;
    if(file.data.date) document.getElementById('match-date').value = file.data.date;
    if(file.data.porteros) porteros = file.data.porteros;
    if(file.data.attackers) attackers = file.data.attackers;
    dosEquipos = !!file.data.dosEquipos && teamPorteros(2).length>0;
    teamNames = (file.data.teamNames && file.data.teamNames.length===2) ? file.data.teamNames.slice() : ['Equipo 1','Equipo 2'];
    equipoRecibe = 1; selectedAttacker = null;
    activePorteroId = teamPorteros(1)[0] ? teamPorteros(1)[0].id : activePorteroId;
    activePorteroId2 = dosEquipos ? teamPorteros(2)[0].id : null;
    applyDosUI();
    renderPorteros();
    renderAttackers();
    renderFilterBars();
    // Switch to stats section
    document.querySelectorAll('.section').forEach(function(s){ s.style.display='none'; });
    var statsEl = document.getElementById('sec-estadisticas');
    if(statsEl){ statsEl.style.display='block'; }
    renderStats();
    notify('📊 Partido cargado: ' + (file.data.rival || file.name || 'Sin nombre'));
  }
}

// Sustituye a los antiguos syncAllToCloud()/downloadAllFromCloud() (sobrescritura total
// en cada sentido, sin fusión — causa real de la pérdida de datos de 2026-09-15). Un único
// botón que hace lo mismo que ya hace el sync automático (fusionar, nunca sobrescribir),
// pero forzado al momento: reutiliza _fbSync/_fbMergeOnStart/_fbSyncRivals/
// _fbMergeRivalsOnStart, ya probados, y además re-sube el contenido de cada partido local
// (red de seguridad por si alguna subida automática anterior falló en silencio con una
// conexión inestable).
function syncNow(){
  var btn = document.getElementById('btn-sync-now');
  if(btn){ btn.textContent='⏳ Sincronizando...'; btn.disabled=true; }
  function finish(ok, msg){
    if(btn){ btn.textContent='🔄 Sincronizar ahora'; btn.disabled=false; }
    notify((ok?'✅ ':'❌ ')+msg, !ok);
  }
  if(!window._fbReady || !window._fbDb){ finish(false,'Firebase no disponible.'); return; }

  // Paso 1: trae PRIMERO lo que la nube tenga y el local no tuviera (partidos y rivales),
  // y espera a que termine de verdad antes de subir nada. Antes esto se llamaba a la vez
  // que la subida, sin esperar — y como _fbSync ya marca hb_fs6_ts local como "al día" en
  // el mismo instante en que escribe, la comparación de _fbMergeOnStart podía salir falsa
  // antes de haber bajado ni un solo partido, dejando el dispositivo viendo la biblioteca
  // vacía aunque la nube estuviera perfectamente intacta (bug real, ver regla 28). Se
  // fuerza (force=true) para no fiarse de una marca de tiempo local que ya pudiera haber
  // quedado corrupta por un intento anterior fallido.
  function _step2(){
    // Paso 2: con el local ya al día, sube el contenido de cada partido local que TODAVÍA
    // no se haya confirmado sincronizado (red de seguridad por si alguna subida automática
    // anterior falló en silencio) y fusiona la estructura/rivales de vuelta hacia la nube.
    // Antes se volvía a subir el contenido COMPLETO de TODOS los partidos en cada click,
    // aunque no hubiera cambiado nada desde el intento anterior — por eso "Sincronizar
    // ahora" tardaba igual de mucho por más veces que se repitiera (comprobado el
    // 2026-09-18). `_fileTsCache` ya sabe qué partidos están confirmados al día (lo
    // actualiza tanto el guardado normal como esta misma subida), así que a partir de la
    // primera vez que se confirma un partido, ya no hace falta volver a subirlo aquí.
    var fs = loadFS();
    var ts = Date.now();
    var uploadPromises = (fs.files||[]).map(function(file){
      if(file.id in _fileTsCache) return Promise.resolve();
      var fileClean = JSON.parse(JSON.stringify(file));
      if(fileClean.data && fileClean.data.porteros) fileClean.data.porteros.forEach(function(p){ p.photo=null; });
      var serialized = JSON.stringify(fileClean);
      if(serialized.length/1024 >= 900) return Promise.resolve();
      return window._fbSetDoc(window._fbDoc(window._fbDb,'sync','hb_file_'+file.id), {data:serialized, ts:ts})
        .then(function(){ _markFileSynced(file.id, ts); })
        .catch(function(){});
    });
    Promise.all(uploadPromises).then(function(){
      _fbSync('hb_fs6', loadFS(), function(){
        _fbSyncRivals(_rivalsFSCache || {folders:[],teams:[]}, function(){
          renderExplorer();
          try{ renderRivalsDir(); }catch(e){}
          _syncPhotos(false, function(){ finish(true, 'Sincronización completa'); });
        });
      });
    }).catch(function(e){ finish(false, 'Error: '+e.message); });
  }
  _fbMergeOnStart(function(){
    _fbMergeRivalsOnStart(_step2, true);
  }, true);
}

// ── Marca de "ya sincronizado" por partido (2026-09-18) ──────────────────────────────────
// `_fbMergeOnStart` (arranque automático y "Sincronizar ahora") descargaba el contenido
// COMPLETO de TODOS los partidos en CADA sincronización, sin importar si ya los tenía —
// con 67 partidos reales (~6.75MB) eso son 67 peticiones de red y varios MB transferidos
// cada vez que se abre la app o se pulsa el botón, y otra vez lo mismo si se repite (nada
// se recordaba entre intentos). `_fileTsCache` guarda, por cada partido, el `ts` (marca de
// tiempo) de la versión que este dispositivo YA sabe que coincide con la nube — puesta al
// subir (`syncSingleMatchToCloud`/subida completa) o al bajar (`_fbMergeOnStart`). Se
// comparte dentro de `hb_structure.fileTs` (además de `fileIds`) para que cualquier
// dispositivo pueda saber, con una sola lectura barata de la estructura, qué partidos han
// cambiado de verdad desde la última vez sin tener que descargarlos todos para comprobarlo.
var _fileTsCache = {};   // {fileId: ts}

function loadFileTsCache(done){
  _idbGet('hb_file_ts', function(val){
    _fileTsCache = val || {};
    if(done) done();
  });
}
function _markFileSynced(fileId, ts){
  _fileTsCache[fileId] = ts;
  _idbSet('hb_file_ts', _fileTsCache);
}

// ── Firebase sync layer ───────────────────────────────────────────────────────
function _fbSync(key, value, done){
  // Sube solo el documento ligero de estructura (carpetas + IDs de partido).
  // El contenido de cada partido ya se sube por su cuenta con syncSingleMatchToCloud()
  // al guardar (ver saveMatch()) — re-subirlo aquí también duplicaba cada partido
  // y, peor, re-subía TODOS los partidos existentes en cada cambio de estructura
  // (renombrar, mover, reordenar...), haciendo el guardado cada vez más pesado
  // a medida que se acumulaban partidos en la temporada.
  if(!window._fbReady || !window._fbDb){ if(done) done(); return; }
  if(key !== 'hb_fs6'){ if(done) done(); return; } // only sync fs
  var localFolders = value.folders || [];
  var localFileIds = (value.files||[]).map(function(f){return f.id;});
  var localPurgedIds = value.purgedIds || {};
  // ANTES: esto sobrescribía hb_structure entero con solo lo que ESTE dispositivo conoce
  // en local. Si otro dispositivo acababa de añadir un partido, esa referencia se perdía
  // (el documento hb_file_<id> seguía existiendo en Firestore, pero quedaba huérfano e
  // invisible hasta una sincronización manual completa). Ahora se lee lo que hay en la
  // nube y se fusiona antes de escribir, en vez de partir solo del estado local.
  _fbPull('hb_structure', function(remote){
    var remoteFolders = [], remoteFileIds = [], remoteFileTs = {}, remotePurgedIds = {};
    if(remote){
      try{
        var remoteStructure = JSON.parse(remote.data);
        remoteFolders = remoteStructure.folders || [];
        remoteFileIds = remoteStructure.fileIds || [];
        remoteFileTs = remoteStructure.fileTs || {};
        remotePurgedIds = remoteStructure.purgedIds || {};
      }catch(e){}
    }
    // Borrado definitivo compartido (2026-09-20, ver purgeTrashItemNow/_purgeOldTrash): un
    // id presente aquí significa "eliminado para siempre, no volver a añadir jamás" — se
    // fusiona quedándose con el ts más alto por id, igual que fileTs, y se usa más abajo
    // para excluir esos ids de mergedFolders/mergedFileIds en TODOS los dispositivos.
    var mergedPurgedIds = Object.assign({}, remotePurgedIds);
    Object.keys(localPurgedIds).forEach(function(id){
      if(!(id in mergedPurgedIds) || localPurgedIds[id] > mergedPurgedIds[id]) mergedPurgedIds[id] = localPurgedIds[id];
    });
    var localFolderIds = {};
    localFolders.forEach(function(f){ localFolderIds[f.id]=true; });
    // Carpetas: además de añadir las que solo existiera en la nube (igual que antes), ahora
    // se reconcilia trashedAt/trashId/stateTs/isTrashRoot cuando la MISMA carpeta existe en
    // los dos lados — gana el stateTs más alto (mismo patrón que ya usa _mergeRivalsData con
    // updatedAt), para que borrar/restaurar una carpeta se propague sin pisar el resto de
    // cambios locales que no tengan que ver con la papelera.
    var remoteFolderById = {};
    remoteFolders.forEach(function(f){ remoteFolderById[f.id]=f; });
    var mergedFolders = localFolders.map(function(f){
      var rf = remoteFolderById[f.id];
      if(rf && (rf.stateTs||0) > (f.stateTs||0)) return Object.assign({}, f, {trashedAt:rf.trashedAt, trashId:rf.trashId, stateTs:rf.stateTs, isTrashRoot:rf.isTrashRoot});
      return f;
    }).concat(remoteFolders.filter(function(f){ return !localFolderIds[f.id]; }))
      .filter(function(f){ return !mergedPurgedIds[f.id]; });
    var localFileIdSet = {};
    localFileIds.forEach(function(id){ localFileIdSet[id]=true; });
    var mergedFileIds = localFileIds.concat(remoteFileIds.filter(function(id){ return !localFileIdSet[id]; }))
      .filter(function(id){ return !mergedPurgedIds[id]; });
    // Se queda con el ts más alto de cada partido entre lo que ya sabía este dispositivo
    // (_fileTsCache) y lo que hubiera en la nube — igual que el resto de fusiones de esta
    // función, nunca se pisa a ciegas.
    var mergedFileTs = Object.assign({}, remoteFileTs);
    Object.keys(_fileTsCache).forEach(function(id){
      if(!(id in mergedFileTs) || _fileTsCache[id] > mergedFileTs[id]) mergedFileTs[id] = _fileTsCache[id];
    });

    var ts = Date.now();
    var structure = { folders: mergedFolders, fileIds: mergedFileIds, fileTs: mergedFileTs, purgedIds: mergedPurgedIds, ts: ts };
    try {
      window._fbSetDoc(window._fbDoc(window._fbDb, 'sync', 'hb_structure'), { data: JSON.stringify(structure), ts: ts })
        .then(function(){ if(done) done(); })
        .catch(function(e){ console.warn('Firebase write failed:', e.message); if(done) done(); });
      _idbSet('hb_fs6_ts', ts);
    } catch(e) { console.warn('Firebase sync error:', e); if(done) done(); }
  });
}

function _fbPull(key, cb){
  if(!window._fbReady || !window._fbDb){ cb(null); return; }
  window._fbGetDoc(window._fbDoc(window._fbDb,'sync',key))
    .then(function(snap){ cb(snap.exists() ? snap.data() : null); })
    .catch(function(){ cb(null); });
}
// `done` (opcional, 2026-09-15) se llama SIEMPRE al terminar, en cualquier rama — lo usa
// syncNow() para poder esperar a que el pull+merge realmente termine antes de subir nada
// (ver el bug de la regla 28: llamar a _fbSync() y _fbMergeOnStart() uno detrás de otro SIN
// esperar podía dejar el dispositivo con el _fsCache local vacío aunque la nube tuviera
// todos los partidos, porque _fbSync ya actualiza hb_fs6_ts al mismo instante en que
// escribe, y si _fbMergeOnStart lee ese mismo ts como "local" antes de haber bajado nada,
// remoteTs > localTs sale falso y nunca llega a pedir los partidos). Las llamadas
// existentes (saveFS, el listener en tiempo real) no pasan `done` y siguen funcionando
// exactamente igual que antes.
// `force` (2026-09-15, lo usa syncNow()) se salta la comparación de timestamps y fuerza el
// pull+merge completo siempre — necesario porque si un intento anterior de sincronizar
// dejó `hb_fs6_ts` local apuntando a un valor alto sin haber llegado a bajar el contenido
// real (el bug de la regla 28, antes del fix de secuenciación), el dispositivo se quedaría
// creyendo para siempre que "ya está al día" sin estarlo. Un "Sincronizar ahora" manual
// tiene que poder saltarse esa marca y comprobarlo todo de verdad.
function _fbMergeOnStart(done, force){
  _fbPull('hb_structure', function(remote){
    if(!remote){ if(done) done(); return; }
    var remoteTs = remote.ts || 0;
    _idbGet('hb_fs6_ts', function(localTs){
      localTs = localTs || 0;
      if(force || remoteTs > localTs){
        try {
          var structure = JSON.parse(remote.data);
          var fileIds = structure.fileIds || [];
          var folders = structure.folders || [];
          var remoteFileTs = structure.fileTs || {};
          var remotePurgedIds = structure.purgedIds || {};
          // Borrado definitivo compartido (2026-09-20): fusiona con lo que este dispositivo
          // ya supiera (mismo patrón que fileTs, gana el ts más alto) y lo persiste — un id
          // que aparezca aquí nunca se vuelve a pedir ni a mostrar, en ningún dispositivo.
          var mergedPurgedIds = Object.assign({}, (_fsCache && _fsCache.purgedIds) || {});
          Object.keys(remotePurgedIds).forEach(function(id){
            if(!(id in mergedPurgedIds) || remotePurgedIds[id] > mergedPurgedIds[id]) mergedPurgedIds[id] = remotePurgedIds[id];
          });
          // Antes se volvía a descargar el contenido COMPLETO de TODOS los partidos aquí,
          // en cada arranque y en cada "Sincronizar ahora", sin mirar si ya los teníamos
          // (con 67 partidos reales, ~6.75MB transferidos cada vez, y otra vez lo mismo si
          // se repetía — comprobado el 2026-09-18 como causa real de sincronizaciones de
          // varios minutos). Ahora solo se baja el contenido de un partido si: nunca se ha
          // visto en este dispositivo, o nunca se confirmó que coincide con la nube, o la
          // nube tiene una versión más nueva que la última confirmada (`_fileTsCache`,
          // actualizado al subir o al bajar con éxito). Un partido nuevo SIEMPRE se detecta
          // (no está en `_fileTsCache`), así que sigue llegando igual que antes.
          var localFileIdSet2 = {};
          (_fsCache && _fsCache.files || []).forEach(function(f){ localFileIdSet2[f.id]=true; });
          var neededIds = fileIds.filter(function(fid){
            if(mergedPurgedIds[fid]) return false;
            if(!localFileIdSet2[fid]) return true;
            if(!(fid in _fileTsCache)) return true;
            return (remoteFileTs[fid]||0) > _fileTsCache[fid];
          });
          // ANTES: _fsCache se reemplazaba entero por lo que llegaba de la nube. Si este
          // dispositivo tenía un partido guardado en local que aún no le había dado tiempo
          // a subir, se perdía en silencio (sin aviso, sin copia de seguridad) en cuanto
          // otro dispositivo empujaba una estructura más reciente. Ahora se FUSIONA con lo
          // que ya hay en local, con la misma política que ya usa importData(): nunca se
          // sobrescribe un partido local a ciegas, solo se añade lo que falta y se
          // actualiza un partido si la versión remota es más reciente (por fecha).
          function _mergeRemoteAndApply(remoteFiles){
            var current = _fsCache || {folders:[], files:[]};
            var folderIndexById = {};
            current.folders.forEach(function(f,i){ folderIndexById[f.id]=i; });
            folders.forEach(function(f){
              if(!(f.id in folderIndexById)){
                current.folders.push(f);
              } else {
                // Reconcilia SOLO el estado de papelera (trashedAt/trashId/stateTs/
                // isTrashRoot) por separado del resto de la carpeta — gana el stateTs más
                // alto (2026-09-20), sin tocar nombre/orden si no ha cambiado el estado.
                var idx = folderIndexById[f.id];
                if((f.stateTs||0) > (current.folders[idx].stateTs||0)){
                  current.folders[idx] = Object.assign({}, current.folders[idx],
                    {trashedAt:f.trashedAt, trashId:f.trashId, stateTs:f.stateTs, isTrashRoot:f.isTrashRoot});
                }
              }
            });
            var fileIndexById = {};
            current.files.forEach(function(f,i){ fileIndexById[f.id]=i; });
            remoteFiles.forEach(function(f){
              if(!(f.id in fileIndexById)){
                current.files.push(f);
              } else {
                var idx = fileIndexById[f.id];
                var localF = current.files[idx];
                var winner = (new Date(f.date) > new Date(localF.date)) ? f : localF;
                // El estado de papelera se decide aparte del contenido (2026-09-20): gana
                // el cambio más reciente (borrar/restaurar), sin importar de cuál de los
                // dos "contenidos" se acabe de quedar arriba.
                var useRemoteState = (f.stateTs||0) > (localF.stateTs||0);
                var stateSrc = useRemoteState ? f : localF;
                winner = Object.assign({}, winner, {
                  trashedAt: stateSrc.trashedAt, trashId: stateSrc.trashId,
                  stateTs: stateSrc.stateTs, isTrashRoot: stateSrc.isTrashRoot
                });
                current.files[idx] = winner;
              }
            });
            // Borrado definitivo (purgedIds): se quita de verdad, en cualquier dispositivo,
            // cualquier carpeta/partido que aparezca en la lista fusionada de purgados —
            // así "eliminar definitivamente" en un dispositivo lo hace desaparecer de todos.
            if(Object.keys(mergedPurgedIds).length){
              current.files = current.files.filter(function(f){ return !mergedPurgedIds[f.id]; });
              current.folders = current.folders.filter(function(f){ return !mergedPurgedIds[f.id]; });
            }
            current.purgedIds = mergedPurgedIds;
            _fsCache = current;
            _idbSet('hb_fs6', _fsCache);
            _idbSet('hb_fs6_ts', remoteTs);
            if(window._appLoaded){ renderExplorer(); try{ renderTrash(); }catch(e){} }
            if(done) done();
          }
          if(neededIds.length === 0){
            _mergeRemoteAndApply([]);
            return;
          }
          var files = [];
          var pending = neededIds.length;
          neededIds.forEach(function(fid){
            _fbPull('hb_file_' + fid, function(fdoc){
              if(fdoc){
                try{ files.push(JSON.parse(fdoc.data)); _markFileSynced(fid, fdoc.ts||Date.now()); }catch(e){}
              }
              pending--;
              if(pending === 0) _mergeRemoteAndApply(files);
            });
          });
        } catch(e){ console.warn('Firebase merge error:', e); if(done) done(); }
      } else {
        // BUG REAL encontrado el 2026-09-18 ("no termina nunca de sincronizar"): esta rama
        // solo se alcanza cuando llama el listener en tiempo real de 'hb_structure' (todos
        // los demás llamadores pasan force=true y nunca llegan aquí). Volver a subir aquí
        // ("por si acaso") retriggeraba el propio listener con la escritura que acabábamos
        // de hacer nosotros mismos (Firestore notifica también los propios cambios locales),
        // que volvía a caer en este mismo "else" y volvía a subir — un bucle sin fin que
        // satura la conexión y hace que cualquier sincronización real parezca no terminar
        // nunca. Confirmado con una simulación de Node que reproducía el bucle de verdad.
        // Las subidas de cambios locales ya las hacen saveMatch()/syncSingleMatchToCloud()/
        // syncNow() por su cuenta — este listener solo necesita traer lo nuevo, nunca volver
        // a empujar lo que ya había.
        if(done) done();
      }
    });
  });
}

// ── Fusión también para el directorio de rivales (2026-09-15) ────────────────────────
// Antes, CUALQUIER edición de rivales (renombrar una carpeta, mover un equipo, tocar la
// lista de jugadores) subía _rivalsFSCache tal cual con un solo _fbSetDoc, sin mirar antes
// qué había en la nube — a diferencia de hb_fs6, que desde el "Batch 10" de la auditoría
// siempre fusiona antes de escribir. Esa asimetría fue la causa real de perder el
// directorio de rivales entero: un dispositivo con rivales vacíos (recién estrenado) hizo
// cualquier edición mínima y pisó la nube con la nada. _fbSyncRivals/_fbMergeRivalsOnStart
// replican exactamente el mismo patrón pull→merge→write que ya usan _fbSync/_fbMergeOnStart
// para partidos, esta vez fusionando carpetas y equipos por id y, si el mismo id existe en
// los dos lados, quedándose con el que tenga el `updatedAt` más reciente (equivalente al
// "más reciente por fecha" que ya se usa para partidos, pero aquí no hay una fecha de
// partido con la que comparar, así que cada mutación de equipo/carpeta debe estampar su
// propio `updatedAt` — ver los puntos marcados con "// updatedAt" en el directorio de
// rivales más abajo).
function _mergeRivalsData(local, remote){
  local = local || {folders:[], teams:[]};
  remote = remote || {folders:[], teams:[]};
  function mergeArr(localArr, remoteArr){
    var byId = {};
    (localArr||[]).forEach(function(x){ byId[x.id] = x; });
    (remoteArr||[]).forEach(function(x){
      var cur = byId[x.id];
      if(!cur) byId[x.id] = x; // solo existe en remoto -> se añade
      else if((x.updatedAt||0) > (cur.updatedAt||0)) byId[x.id] = x; // remoto más reciente -> gana
      // si no, se queda la versión local (ya está en byId)
    });
    return Object.keys(byId).map(function(k){ return byId[k]; });
  }
  return { folders: mergeArr(local.folders, remote.folders), teams: mergeArr(local.teams, remote.teams) };
}
function _fbSyncRivals(rfs, done){
  if(!window._fbReady || !window._fbDb){ if(done) done(); return; }
  _fbPull('hb_rivals6', function(remote){
    var remoteRfs = null;
    if(remote){ try{ remoteRfs = JSON.parse(remote.data); }catch(e){} }
    var merged = _mergeRivalsData(rfs, remoteRfs);
    var ts = Date.now();
    try{
      window._fbSetDoc(window._fbDoc(window._fbDb,'sync','hb_rivals6'), {data:JSON.stringify(merged), ts:ts})
        .then(function(){ if(done) done(); })
        .catch(function(e){ console.warn('Firebase write failed (rivals):', e.message); if(done) done(); });
      _idbSet('hb_rivals6_ts', ts);
    }catch(e){ console.warn('Firebase sync error (rivals):', e); if(done) done(); }
  });
}
function _fbMergeRivalsOnStart(done, force){
  _fbPull('hb_rivals6', function(remote){
    if(!remote){ if(done) done(); return; }
    var remoteTs = remote.ts || 0;
    _idbGet('hb_rivals6_ts', function(localTs){
      localTs = localTs || 0;
      if(force || remoteTs > localTs){
        try{
          var remoteRfs = JSON.parse(remote.data);
          var merged = _mergeRivalsData(_rivalsFSCache, remoteRfs);
          _rivalsFSCache = merged;
          _idbSet('hb_rivals6', merged);
          _idbSet('hb_rivals6_ts', remoteTs);
          if(window._appLoaded){ try{ renderRivalsDir(); }catch(e){} }
        }catch(e){ console.warn('Firebase merge error (rivals):', e); }
        if(done) done();
      } else {
        // Mismo bucle infinito que en _fbMergeOnStart (ver el comentario allí, regla del
        // 2026-09-18): esta rama solo la alcanza el listener en tiempo real de
        // 'hb_rivals6', y volver a subir aquí retriggeraba el propio listener sin fin.
        if(done) done();
      }
    });
  });
}

// Persiste en IndexedDB sin tocar la red — lo usa saveFS() (guardado normal, con sync a
// la nube) y también el autoguardado silencioso de cada evento (autosaveMatchLocal), que
// necesita ser rápido y no disparar tráfico de red en cada tiro.
function _persistLocalOnly(fs){
  _fsCache = fs;
  _idbSet('hb_fs6', fs);
  _idbSet('hb_fs6_ts', Date.now());
}
function saveFS(fs){
  _persistLocalOnly(fs);
  _fbSync('hb_fs6', fs);
};

// ===== SINCRONIZACIÓN DE FOTOS ENTRE DISPOSITIVOS =====
// Un documento de Firestore POR FOTO (nunca un único blob con todas juntas): así cada
// documento se queda muy por debajo del límite de 1MB de Firestore por mucho que se
// acumulen porteras/equipos a lo largo de temporadas, y cada dispositivo solo descarga
// la foto que de verdad necesita ver en ese momento (nunca "todas las que existen").
// Solo se sube una foto cuando el usuario la asigna en ESE dispositivo (nunca como parte
// de una sincronización rutinaria), así que una foto que no cambia nunca se vuelve a subir.
function _photoDocId(kind, key){
  var norm = String(key||'').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'') // quita acentos
    .replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  return 'hb_photo_'+kind+'_'+(norm||'x');
}
function _uploadPhoto(kind, key, base64){
  if(!window._fbReady || !window._fbDb || !base64) return;
  if(base64.length/1024 >= 900) return; // límite de tamaño de documento en Firestore
  window._fbSetDoc(window._fbDoc(window._fbDb,'sync',_photoDocId(kind,key)), {data:base64, ts:Date.now()})
    .then(function(){ /* subida silenciosa en segundo plano */ })
    .catch(function(){ /* sin conexión: no bloquea, se queda solo en local */ });
}
// hasLocalFn()/saveLocalFn(base64) dejan a cada llamador decidir dónde vive su caché local
// (porteras, equipos rivales, logo de temporada...) sin duplicar esta función tres veces.
function _downloadPhotoIfMissing(kind, key, hasLocalFn, saveLocalFn, cb){
  if(hasLocalFn()){ if(cb) cb(true); return; }
  if(!window._fbReady || !window._fbDb){ if(cb) cb(false); return; }
  window._fbGetDoc(window._fbDoc(window._fbDb,'sync',_photoDocId(kind,key)))
    .then(function(snap){
      var got=false;
      if(snap.exists() && snap.data().data){ saveLocalFn(snap.data().data); got=true; }
      if(cb) cb(got);
    })
    .catch(function(){ if(cb) cb(false); });
}
// Borra en segundo plano la foto en la nube cuando se elimina localmente (ej. al borrar
// un equipo rival), para que no queden documentos huérfanos acumulados para siempre.
function _deletePhoto(kind, key){
  if(!window._fbReady || !window._fbDb || !window._fbDeleteDoc) return;
  window._fbDeleteDoc(window._fbDoc(window._fbDb,'sync',_photoDocId(kind,key))).catch(function(){});
}

// El resumen de temporada es un documento aparte sin el <script type="module"> de Firebase
// (mismo motivo que XG_MODEL_SRC arriba): se copia el texto REAL de ese script vía
// textContent y estas 4 funciones vía toString(), para que la ventana de temporada pueda
// subir/bajar su logo sin duplicar a mano ninguna lógica que pueda divergir.
var FIREBASE_INIT_SRC = (function(){
  var s = document.querySelector('script[type="module"]');
  return s ? s.textContent : '';
})();
var PHOTO_SYNC_SRC = [_photoDocId, _uploadPhoto, _downloadPhotoIfMissing, _deletePhoto]
  .map(function(f){ return f.toString(); }).join('\n');

// ── Photo store de porteras (keyed by nombre, stored once) ───────────────────
var _photoCache = {};   // {porteroName: base64}

function loadPhotos(done){
  _idbGet('hb_photos', function(val){
    _photoCache = val || {};
    if(done) done();
  });
}

function savePorteroPhoto(name, base64){
  if(!name || !base64) return;
  _photoCache[name] = base64;
  _idbSet('hb_photos', _photoCache);
  _pushPhoto('portero', name, base64, _stampPhoto('portero', name));
}

function getPorteroPhoto(name){
  return _photoCache[name] || null;
}

// Inject photos from store into a porteros array (mutates in place). Si a alguna portera
// le falta la foto en este dispositivo, se intenta bajar de la nube en segundo plano —
// nunca bloquea el render actual, y si llega, vuelve a pintar la lista de porteros.
function rehydratePhotos(porteros){
  (porteros||[]).forEach(function(p){
    if(!p.name) return;
    p.photo = getPorteroPhoto(p.name) || p.photo || null;
    if(!p.photo){
      _downloadPhotoIfMissing('portero', p.name,
        function(){ return !!_photoCache[p.name]; },
        function(b64){ _photoCache[p.name]=b64; _idbSet('hb_photos', _photoCache); },
        function(got){ if(got) renderPorteros(); }
      );
    }
  });
}

// ── Photo store de equipos rivales (keyed by id de equipo, no por nombre: el nombre se
// puede renombrar, el id nunca cambia) ────────────────────────────────────────────────
var _teamPhotoCache = {};   // {teamId: base64}

function loadTeamPhotos(done){
  _idbGet('hb_team_photos', function(val){
    _teamPhotoCache = val || {};
    if(done) done();
  });
}

function saveTeamPhoto(teamId, base64){
  if(teamId==null || !base64) return;
  _teamPhotoCache[teamId] = base64;
  _idbSet('hb_team_photos', _teamPhotoCache);
  _pushPhoto('equipo', teamId, base64, _stampPhoto('equipo', teamId));
}

function getTeamPhoto(teamId){
  return _teamPhotoCache[teamId] || null;
}

// Si el equipo no tiene foto en este dispositivo, se intenta bajar de la nube en segundo
// plano (nunca bloquea el render actual) y, si llega, se vuelve a pintar el directorio.
function ensureTeamPhoto(teamId){
  if(teamId==null || _teamPhotoCache[teamId]) return;
  _downloadPhotoIfMissing('equipo', teamId,
    function(){ return !!_teamPhotoCache[teamId]; },
    function(b64){ _teamPhotoCache[teamId]=b64; _idbSet('hb_team_photos', _teamPhotoCache); },
    function(got){ if(got) renderRivalsDir(); }
  );
}

// ── Escudo/logo de rival del partido (keyed by nombre de rival, stored once) ─────────────
// Antes, `getMatchData()` incrustaba el escudo entero (sin comprimir, hasta ~700KB) DENTRO
// del JSON de cada partido — si jugabas 4 veces contra el mismo rival, subías y bajabas 4
// copias idénticas del mismo escudo en CADA sincronización completa (comprobado en la nube
// real el 2026-09-18: 11 de 67 partidos llevaban un escudo de >100KB, sumando 3.5MB de los
// 6.75MB totales). Ahora se guarda una sola vez por rival, igual que ya hacen las fotos de
// portero (`_photoCache`) y de equipo (`_teamPhotoCache`).
var _logoCache = {};   // {rivalName: base64}

function loadLogos(done){
  _idbGet('hb_logos', function(val){
    _logoCache = val || {};
    if(done) done();
  });
}

function saveRivalLogo(name, base64){
  name = String(name||'').trim();
  if(!name || !base64) return;
  // getMatchData() llama a esto en CADA autoguardado (varias veces por minuto durante un
  // partido) — sin esta comprobación, se repetiría la subida a Firebase del mismo escudo
  // sin cambios una y otra vez.
  if(_logoCache[name] === base64) return;
  _logoCache[name] = base64;
  _idbSet('hb_logos', _logoCache);
  _pushPhoto('rival', name, base64, _stampPhoto('rival', name));
}

function getRivalLogo(name){
  name = String(name||'').trim();
  return (name && _logoCache[name]) || null;
}

// ── Sincronización de fotos CON VERSIÓN (2026-09-21) ─────────────────────────────────────
// Antes una foto solo se subía en el instante de asignarla (sin conexión se perdía) y un
// dispositivo solo la bajaba si NO la tenía — así que ni las fotos ya existentes en la tablet
// llegaban nunca a la nube (comprobado: 0 documentos hb_photo_* en Firestore) ni un cambio de
// foto llegaba a un dispositivo que ya tenía la antigua. Ahora hay un índice pequeño
// hb_photo_meta ({docId:{k:tipo,n:clave,ts}}) y cada dispositivo guarda el ts de cada foto
// que conoce (_photoTs): gana siempre la más reciente, en los dos sentidos. Las fotos viajan
// en su propio documento (una por foto, como antes), solo se transfiere la que cambió. Sirve
// para portera (por nombre), equipo rival del directorio (por id) y escudo del rival del
// partido (por nombre). No toca _uploadPhoto/_downloadPhotoIfMissing: la ventana de temporada
// las copia con toString() y las sigue usando para su propio logo.
var _photoTs = {};   // {docId: ts de la versión que este dispositivo tiene}
function loadPhotoTs(done){
  _idbGet('hb_photo_ts', function(v){ _photoTs = v || {}; if(done) done(); });
}
function _photoStores(){
  return {
    portero:{cache:_photoCache,     idb:'hb_photos'},
    equipo: {cache:_teamPhotoCache, idb:'hb_team_photos'},
    rival:  {cache:_logoCache,      idb:'hb_logos'}
  };
}
function _stampPhoto(kind, key){
  var ts = Date.now();
  _photoTs[_photoDocId(kind, key)] = ts;
  _idbSet('hb_photo_ts', _photoTs);
  return ts;
}
function _pushPhoto(kind, key, b64, ts, done){
  if(!window._fbReady || !window._fbDb || !b64 || b64.length/1024 >= 900){ if(done) done(false); return; }
  var id = _photoDocId(kind, key);
  var meta = {}; meta[id] = {k:kind, n:String(key), ts:ts};
  window._fbSetDoc(window._fbDoc(window._fbDb,'sync',id), {data:b64, ts:ts})
    .then(function(){ return window._fbSetDoc(window._fbDoc(window._fbDb,'sync','hb_photo_meta'), meta, {merge:true}); })
    .then(function(){ if(done) done(true); })
    .catch(function(){ if(done) done(false); });
}
function _photoInventory(){
  var inv = {}, st = _photoStores();
  Object.keys(st).forEach(function(kind){
    Object.keys(st[kind].cache).forEach(function(key){
      var b64 = st[kind].cache[key]; if(!b64) return;
      var id = _photoDocId(kind, key);
      if(!inv[id]) inv[id] = {kind:kind, key:key, keys:[key], b64:b64};
      else inv[id].keys.push(key); // varias grafías del mismo nombre (tildes/mayúsculas) comparten documento
    });
  });
  return inv;
}
function _setLocalPhoto(kind, keys, b64){
  var s = _photoStores()[kind]; if(!s) return;
  keys.forEach(function(k){ s.cache[k] = b64; });
  _idbSet(s.idb, s.cache);
}
function _refreshAfterPhotos(){
  try{ porteros.forEach(function(p){ if(p.name && _photoCache[p.name]) p.photo = _photoCache[p.name]; }); }catch(e){}
  try{ renderPorteros(); }catch(e){}
  try{ renderStats(); }catch(e){}
  try{ renderRivalsDir(); }catch(e){}
  try{
    var rn = (document.getElementById('rival-name').value||'').trim();
    var lg = rn && _logoCache[rn];
    var li = document.getElementById('logo-img'), lp = document.getElementById('logo-plus');
    if(lg && li && li.src!==lg){ li.src=lg; li.style.display='block'; if(lp) lp.style.display='none'; }
  }catch(e){}
}
var _photoSyncBusy = false;
// pullOnly=true (listener en tiempo real): solo baja, nunca escribe — así no puede dar un bucle.
function _syncPhotos(pullOnly, done){
  if(!window._fbReady || !window._fbDb || _photoSyncBusy){ if(done) done(); return; }
  _photoSyncBusy = true;
  var changed = false;
  function finish(){
    _idbSet('hb_photo_ts', _photoTs);
    _photoSyncBusy = false;
    if(changed) _refreshAfterPhotos();
    if(done) done();
  }
  _fbPull('hb_photo_meta', function(metaDoc){
    var meta = metaDoc || {}, inv = _photoInventory(), jobs = [];
    Object.keys(inv).forEach(function(id){
      var it = inv[id], r = meta[id], lt = _photoTs[id];
      if(r){
        if(lt===undefined || r.ts>lt) jobs.push({t:'down', id:id, kind:it.kind, keys:it.keys, ts:r.ts});
        else if(lt>r.ts && !pullOnly) jobs.push({t:'up', id:id, it:it, ts:lt});
      } else if(!pullOnly){
        jobs.push({t:'legacy', id:id, it:it});
      }
    });
    Object.keys(meta).forEach(function(id){
      var r = meta[id];
      if(inv[id] || !r || !r.k || !_photoStores()[r.k]) return;
      if(_photoTs[id]!==undefined && _photoTs[id]>=r.ts) return; // ya intentada (p.ej. documento borrado)
      jobs.push({t:'down', id:id, kind:r.k, keys:[r.n], ts:r.ts});
    });
    (function next(){
      var j = jobs.shift();
      if(!j){ finish(); return; }
      var ref = window._fbDoc(window._fbDb,'sync',j.id);
      if(j.t==='down'){
        window._fbGetDoc(ref).then(function(snap){
          if(snap.exists() && snap.data().data){ _setLocalPhoto(j.kind, j.keys, snap.data().data); changed = true; }
          _photoTs[j.id] = j.ts; next();
        }).catch(function(){ next(); });
      } else if(j.t==='up'){
        _pushPhoto(j.it.kind, j.it.key, j.it.b64, j.ts, function(){ next(); });
      } else { // legacy: la foto existe en local pero nunca se registró en el índice
        var lt2 = _photoTs[j.id];
        if(lt2!==undefined){ _pushPhoto(j.it.kind, j.it.key, j.it.b64, lt2, function(){ next(); }); return; }
        window._fbGetDoc(ref).then(function(snap){
          if(snap.exists() && snap.data().data){
            // Ya hay una en la nube (subida con el código antiguo): manda la de la nube.
            var cd = snap.data();
            if(cd.data!==j.it.b64){ _setLocalPhoto(j.it.kind, j.it.keys, cd.data); changed = true; }
            _photoTs[j.id] = cd.ts || Date.now();
            var m = {}; m[j.id] = {k:j.it.kind, n:String(j.it.key), ts:_photoTs[j.id]};
            return window._fbSetDoc(window._fbDoc(window._fbDb,'sync','hb_photo_meta'), m, {merge:true}).then(function(){ next(); });
          }
          var ts = Date.now(); _photoTs[j.id] = ts;
          _pushPhoto(j.it.kind, j.it.key, j.it.b64, ts, function(){ next(); });
        }).catch(function(){ next(); });
      }
    })();
  });
}

// ===== HELPERS =====
function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtTime(s){
  return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
}
function notify(msg,err){
  var n=document.getElementById('notif');
  n.textContent=msg; n.className='notif'+(err?' error':'');
  n.classList.add('show'); setTimeout(function(){n.classList.remove('show');},2500);
}

// ===== INIT =====
document.getElementById('match-date').textContent = new Date().toLocaleDateString('es-ES',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
document.getElementById('logo-input').addEventListener('change',function(e){
  var f=e.target.files[0]; if(!f) return;
  var r=new FileReader(); r.onload=function(ev){
    document.getElementById('logo-img').src=ev.target.result;
    document.getElementById('logo-img').style.display='block';
    document.getElementById('logo-plus').style.display='none';
  }; r.readAsDataURL(f);
});
document.getElementById('portero-photo-input').addEventListener('change',function(e){
  var f=e.target.files[0]; if(!f||porteroPhotoTarget===null) return;
  var r=new FileReader(); r.onload=function(ev){
    var p=porteros.find(function(x){return x.id===porteroPhotoTarget;});
    if(p){
      p.photo=ev.target.result; p.ox=50; p.oy=20;
      savePorteroPhoto(p.name, p.photo);
      renderPorteros();
      if(currentMatchId) saveMatch();
    }
    e.target.value=''; // reset so same file can be re-selected
  }; r.readAsDataURL(f);
});
var rivalPhotoTarget = null;
// El <input id="rival-photo-input"> vive dentro del modal del directorio de rivales, muy
// al final del <body> (fuera de .app, junto a los demás overlays) — muy por debajo de este
// <script>, que se ejecuta según el navegador va leyendo el documento de arriba abajo. Si
// se engancha el listener aquí directamente, el elemento todavía no existe en el DOM y
// getElementById devuelve null: el .addEventListener sobre null lanzaba una excepción que
// detenía TODO el resto de este bloque de script — incluido initStorage() y el arranque de
// la sincronización automática, que están más abajo en el archivo (2026-09-17, el bug real
// detrás de "la app nunca sincroniza sola al abrirla", nada que ver con timestamps ni con
// caché). Fix: esperar a que el DOM esté listo antes de engancharlo.
document.addEventListener('DOMContentLoaded', function(){
  var rpi = document.getElementById('rival-photo-input');
  if(rpi) rpi.addEventListener('change',function(e){
    var f=e.target.files[0]; if(!f||rivalPhotoTarget===null) return;
    var r=new FileReader(); r.onload=function(ev){
      saveTeamPhoto(rivalPhotoTarget, ev.target.result);
      renderRivalsDir();
      e.target.value=''; // reset so same file can be re-selected
    }; r.readAsDataURL(f);
  });
});
function triggerRivalPhoto(teamId){ rivalPhotoTarget=teamId; document.getElementById('rival-photo-input').click(); }

// ===== TIMER =====
// Pantalla siempre encendida mientras corre el cronómetro (2026-09-21): la Screen Wake Lock API
// evita que la tablet apague la pantalla por inactividad (el bloqueo manual con el botón de
// encendido no se puede impedir). El sistema la suelta solo al ocultar la app, así que se vuelve
// a pedir al volver a primer plano si el reloj sigue en marcha.
var _wakeLock=null;
function _acquireWakeLock(){
  try{
    if(!('wakeLock' in navigator) || _wakeLock) return;
    navigator.wakeLock.request('screen').then(function(l){
      _wakeLock=l;
      l.addEventListener('release', function(){ _wakeLock=null; });
      notify('🔆 La pantalla no se apagará mientras corra el cronómetro');
    }).catch(function(){ _wakeLock=null; });
  }catch(e){ _wakeLock=null; }
}
function _releaseWakeLock(){
  if(_wakeLock){ try{ _wakeLock.release(); }catch(e){} _wakeLock=null; }
}
document.addEventListener('visibilitychange', function(){ if(!document.hidden && realTimerRunning) _acquireWakeLock(); });
function startTimer(){
  if(!timerRunning){
    if(activePorteroId===null&&porteros.length) activePorteroId=porteros[0].id;
    timerRunning=true;
    timerInterval=setInterval(_timerTick, 1000/timeSpeedMultiplier);
  }
  // El reloj de vídeo solo arranca una vez; "Pausar" no lo toca, así que si ya
  // estaba en marcha (venimos de una pausa del marcador) lo dejamos como está.
  if(!realTimerRunning){
    realTimerRunning=true;
    realStartTs=Date.now()-Math.round(realSeconds*1000/timeSpeedMultiplier); // conserva lo ya contado (reanudación tras Detener, o partido cargado)
    _acquireWakeLock();
    realTimerInterval=setInterval(_realTimerTick, 1000/timeSpeedMultiplier);
  }
  document.getElementById('btn-start').style.display='none';
  document.getElementById('btn-pause').style.display='inline-flex';
  document.getElementById('btn-hardstop').style.display='inline-flex';
  document.getElementById('timer-status').textContent='⏱ Cronómetro en marcha';
  document.getElementById('timer-display').classList.add('running');
}
// Pausa SOLO el reloj del marcador (tiempos muertos, incidencias...); el reloj
// de vídeo real sigue corriendo, porque la grabación no se detiene con él.
function pauseTimer(){
  if(!timerRunning) return;
  clearInterval(timerInterval); timerRunning=false;
  document.getElementById('btn-start').style.display='inline-flex';
  document.getElementById('btn-pause').style.display='none';
  document.getElementById('timer-status').textContent=realTimerRunning?'Partido en pausa (el vídeo sigue corriendo)':'Cronómetro detenido';
  document.getElementById('timer-display').classList.remove('running');
}
// Detiene AMBOS relojes (fin de parte, cambio de partido, etc.)
function stopTimer(){
  if(timerRunning){ clearInterval(timerInterval); timerRunning=false; }
  if(realTimerRunning){ _syncRealSeconds(); clearInterval(realTimerInterval); realTimerRunning=false; _releaseWakeLock(); }
  document.getElementById('btn-start').style.display='inline-flex';
  document.getElementById('btn-pause').style.display='none';
  document.getElementById('btn-hardstop').style.display='none';
  document.getElementById('timer-status').textContent='Cronómetro detenido';
  document.getElementById('timer-display').classList.remove('running');
}
function resetTimer(){
  stopTimer(); timerSeconds=0; realSeconds=0; realStartTs=null; porteros.forEach(function(p){p.seconds=0;});
  timeSpeedMultiplier=1;
  var b=document.getElementById('btn-speed');
  if(b){ b.textContent='1×'; b.classList.remove('active'); b.title='Duplica la velocidad del cronómetro y del reloj de vídeo, para cuando ves el partido grabado a x2'; }
  updateTimerDisplay(); updateRealTimerDisplay(); renderPorteros();
  document.getElementById('timer-status').textContent='Reiniciado';
}
function updateRealTimerDisplay(){
  var t=_syncRealSeconds();
  var hh=Math.floor(t/3600), mm=Math.floor((t%3600)/60), ss=t%60;
  var el=document.getElementById('real-timer-display');
  if(el) el.textContent=String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0');
}
function changeScore(team, delta){
  if(team==='us'){
    scoreUs=Math.max(0,scoreUs+delta);
    document.getElementById('score-us').textContent=scoreUs;
    // Registrar gol propio con el minuto actual (para el timeline)
    if(delta>0){
      var t=document.getElementById('timer-display')?document.getElementById('timer-display').textContent.trim():'00:00';
      ownGoals.push({time:t, id:Date.now()});
    } else if(delta<0 && ownGoals.length){
      ownGoals.pop(); // deshacer el último gol registrado
    }
    try{ drawTimeline(getFilteredShots()); }catch(e){}
  }
  else { scoreThem=Math.max(0,scoreThem+delta); document.getElementById('score-them').textContent=scoreThem; }
  autosaveMatchLocal();
}
function applyScoreSwap(swapped){
  var sb=document.querySelector('.scoreboard');
  var blockUs=document.getElementById('score-block-us');
  var blockThem=document.getElementById('score-block-them');
  if(!sb||!blockUs||!blockThem) return;
  var sep=sb.children[1];
  var currentlySwapped = blockThem===sb.firstElementChild;
  if(swapped && !currentlySwapped){
    sb.insertBefore(blockThem, sep);
    sb.appendChild(blockUs);
  } else if(!swapped && currentlySwapped){
    sb.insertBefore(blockUs, sep);
    sb.appendChild(blockThem);
  }
}
function swapScore(){
  if(dosEquipos) return; // con 2 equipos el marcador se calcula solo a partir de los goles
  var tmp=scoreUs; scoreUs=scoreThem; scoreThem=tmp;
  document.getElementById('score-us').textContent=scoreUs;
  document.getElementById('score-them').textContent=scoreThem;
  scoreSwapped=!scoreSwapped;
  applyScoreSwap(scoreSwapped);
}
function updateTimerDisplay(){
  var t;
  if(dosEquipos){
    // Los dos equipos juegan a la vez: el reloj del partido es el de un equipo, no la suma de ambos
    var sumT=function(tm){return teamPorteros(tm).reduce(function(a,p){return a+(p.seconds||0);},0);};
    t=Math.max(sumT(1),sumT(2));
  } else t=porteros.reduce(function(a,p){return a+(p.seconds||0);},0);
  timerSeconds=t;
  document.getElementById('timer-display').textContent=
    String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');
}

function updatePorteroName(el, pid, isFinal){
  var p = porteros.find(function(x){ return x.id===pid; });
  if(!p) return;
  var newName = el.value;
  p.name = newName;
  // Update all shots and contribs with this portero's id
  shots.forEach(function(s){ if(s.porteroId===pid) s.porteroName=newName; });
  otrasContribs.forEach(function(o){ if(o.porteroId===pid) o.porteroName=newName; });
  // Auto-fill photo if we recognise this name
  var knownPhoto = getPorteroPhoto(newName);
  if(knownPhoto && knownPhoto !== p.photo){
    p.photo = knownPhoto; p.ox = p.ox||50; p.oy = p.oy||20;
    renderPorteros(); // re-render to show the photo
    // restore focus after re-render
    var inp2 = document.querySelector('.portero-name-input[data-pid="'+pid+'"]');
    if(inp2){ inp2.focus(); var l=inp2.value.length; inp2.setSelectionRange(l,l); }
  }
  // Always persist to localStorage immediately (no photos, just names)
  var tpl = teamPorteros(1).map(function(q){ return{id:q.id,name:q.name,dorsal:q.dorsal||'',photo:null,ox:q.ox,oy:q.oy}; });
  try{ localStorage.setItem('hb_last_porteros', JSON.stringify(tpl)); }catch(e){}
  // Save match: debounced on input, immediate on blur
  clearTimeout(el._nt);
  if(isFinal){
    if(currentMatchId) saveMatch();
  } else {
    el._nt = setTimeout(function(){ if(currentMatchId) saveMatch(); }, 800);
  }
}
// Dorsal de la portera — se usa para emparejar con XPS al importar lanzamientos
function updatePorteroDorsal(el, pid){
  var p = porteros.find(function(x){ return x.id===pid; });
  if(!p) return;
  p.dorsal = el.value.trim();
  var tpl = teamPorteros(1).map(function(q){ return{id:q.id,name:q.name,dorsal:q.dorsal||'',photo:null,ox:q.ox,oy:q.oy}; });
  try{ localStorage.setItem('hb_last_porteros', JSON.stringify(tpl)); }catch(e){}
  clearTimeout(el._dt);
  el._dt = setTimeout(function(){ if(currentMatchId) saveMatch(); }, 800);
}

// Racha de acciones consecutivas de un portero (paradas o goles seguidos; los tiros
// "fuera" no cuentan ni cortan la racha, se ignoran directamente). Se ordena por el
// minuto de juego (no por el orden en que se registraron) para que editar un tiro más
// tarde no descuadre qué fue lo último que pasó.
function rachaPortero(shotsArr){
  var relevantes=(shotsArr||[]).filter(function(s){
    return !s.noGk && (s.result==='parada'||s.result==='gol'||s.result==='sinportero');
  }).slice().sort(function(a,b){ return timeToSec(a.time)-timeToSec(b.time); });
  if(!relevantes.length) return null;
  var ultimoEsGol=relevantes[relevantes.length-1].result!=='parada';
  var count=0;
  for(var i=relevantes.length-1;i>=0;i--){
    var esGol=relevantes[i].result!=='parada'; // 'gol' o el legado 'sinportero' cuentan como gol
    if(esGol!==ultimoEsGol) break;
    count++;
  }
  return { count:count, tipo: ultimoEsGol?'gol':'parada' };
}
// ===== PORTEROS =====
// Actualización ligera de "cada segundo" (2026-09-18): antes, el intervalo del cronómetro
// llamaba a renderPorteros() entero cada segundo, que hace innerHTML='' y reconstruye TODA
// la tarjeta de cada portero desde cero — incluida su foto (<img src="data:...">). Eso
// obliga al navegador a volver a decodificar la foto completa (comprobado con fotos reales
// de hasta ~7MB ya decodificadas) cada segundo durante todo el partido, lo que en una
// tablet con menos memoria disponible puede agotarla y hacer que el proceso se cierre solo
// ("Error al mostrar esta página"). Lo ÚNICO que de verdad cambia cada segundo es el
// cronómetro del portero activo — ni sus estadísticas (dependen de shots, no del tiempo)
// ni su foto ni el resto de la tarjeta necesitan reconstruirse. Este SOLO toca el texto del
// tiempo, sin tocar la foto ni volver a enganchar el arrastre.
function updateActivePorteroTimeDisplay(){
  [activePorteroId, dosEquipos?activePorteroId2:null].forEach(function(id){
    if(id===null) return;
    var p=porteros.find(function(x){return x.id===id;});
    if(!p) return;
    var el=document.getElementById('pt-'+p.id);
    if(el) el.textContent=fmtTime(p.seconds);
  });
}
function renderPorteros(){
  // If a name input is currently focused, only update the parts that don't include it
  var focusedPid = null;
  var focused = document.activeElement;
  if(focused && focused.classList.contains('portero-name-input')){
    focusedPid = parseInt(focused.getAttribute('data-pid'));
  }

  _renderPorteroList('porteros-list',1);
  if(dosEquipos) _renderPorteroList('porteros-list-2',2);

  // Restore focus to the input that was being edited
  if(focusedPid!==null){
    var inp=document.querySelector('.portero-name-input[data-pid="'+focusedPid+'"]');
    if(inp){ inp.focus(); var len=inp.value.length; inp.setSelectionRange(len,len); }
  }
  updateActiveGkBubble();
}
// Burbuja flotante con el portero que recibe ahora (visible cuando la tarjeta de porteros
// sale de la pantalla al hacer scroll hacia los recuadros de campo/portería).
var gkBubbleCardVisible = true;
function updateActiveGkBubble(){
  var bubble=document.getElementById('gk-bubble');
  if(!bubble) return;
  var sec=document.getElementById('sec-registro');
  var inRegistro = sec && sec.classList.contains('active');
  var id=receivingPid();
  var p=(id!==null&&id!==undefined)?porteros.find(function(x){return x.id===id;}):null;
  if(!inRegistro || gkBubbleCardVisible || !p){
    bubble.classList.remove('show');
    return;
  }
  var photoEl=document.getElementById('gk-bubble-photo');
  photoEl.innerHTML = p.photo ? '<img src="'+p.photo+'" style="object-position:'+p.ox+'% '+p.oy+'%">' : '👤';
  document.getElementById('gk-bubble-name').textContent = p.name || 'Portero';
  var teamEl=document.getElementById('gk-bubble-team');
  if(dosEquipos){
    var t=porteroTeam(p.id);
    teamEl.textContent = teamNames[t-1] || ('Equipo '+t);
    teamEl.style.display='block';
  } else {
    teamEl.style.display='none';
  }
  bubble.classList.add('show');
}
function scrollToActiveGkCard(){
  var id=receivingPid();
  if(id===null||id===undefined) return;
  var el=document.getElementById('portero-card-'+id);
  if(el) el.scrollIntoView({behavior:'smooth', block:'center'});
}
(function(){
  var wrap=document.getElementById('porteros-grid-wrap');
  if(wrap && 'IntersectionObserver' in window){
    new IntersectionObserver(function(entries){
      gkBubbleCardVisible = entries[0].isIntersecting;
      updateActiveGkBubble();
    }, {threshold:0}).observe(wrap);
  }
})();
function _renderPorteroList(listId, team){
  var list=document.getElementById(listId); list.innerHTML='';
  var activeId=activePidOf(team);
  teamPorteros(team).forEach(function(p){
    var sp=shots.filter(function(s){return s.porteroId===p.id;});
    var par=sp.filter(function(s){return s.result==='parada';}).length;
    var le=sp.filter(function(s){return s.result!=='fuera'&&s.result!=='sinportero'&&!s.noGk;}).length;
    var pp=le>0?Math.round(par/le*100):null;
    var gsaxP=calcularGSAx(sp, p.id);
    var rachaP=rachaPortero(sp);
    var div=document.createElement('div');
    var isActive=activeId===p.id;
    var isReceiving=dosEquipos&&isActive&&equipoRecibe===team;
    div.id='portero-card-'+p.id;
    div.className='portero-card'+(isActive?' active':'')+(isReceiving?' receiving':'')+(dosEquipos&&isActive&&!isReceiving?' waiting':'');
    div.onclick=function(e){
      if(e.target.closest('.photo-container,.photo-slot,.portero-name-input')) return;
      setActivePortero(p.id);
    };
    div.innerHTML=
      (isReceiving?'<div class="active-badge">🛡️ DEFIENDE</div>':(isActive?'<div class="active-badge">EN JUEGO</div>':''))+
      (p.photo
        ?'<div class="photo-container" id="pc-'+p.id+'" title="Doble clic para cambiar foto" ondblclick="event.stopPropagation();triggerPhoto('+p.id+')"><img src="'+p.photo+'" id="pi-'+p.id+'" style="object-position:'+p.ox+'% '+p.oy+'%" draggable="false"></div>'
        :'<div class="photo-slot" ondblclick="event.stopPropagation();triggerPhoto('+p.id+')" onclick="event.stopPropagation();triggerPhoto('+p.id+')">👤</div>')+
      '<div class="portero-name-row">'+
        '<input class="portero-dorsal-input" data-pid="'+p.id+'" value="'+escHtml(p.dorsal||'')+'" placeholder="Nº" maxlength="3" onclick="event.stopPropagation()" oninput="updatePorteroDorsal(this,'+p.id+')">'+
        '<input class="portero-name-input" data-pid="'+p.id+'" value="'+escHtml(p.name)+'" placeholder="Nombre" onclick="event.stopPropagation()" oninput="updatePorteroName(this,'+p.id+')" onblur="updatePorteroName(this,'+p.id+',true)">'+
      '</div>'+
      '<div class="portero-mins">Tiempo: <span id="pt-'+p.id+'" title="Clic para editar" style="cursor:pointer;border-bottom:1px dashed var(--gray)" onclick="editPorteroTime('+p.id+')">'+fmtTime(p.seconds)+'</span></div>'+
      '<div class="portero-stats-mini">'+(pp!==null?'<span class="pct">'+pp+'%</span> paradas':'Sin lanzamientos')+
        (gsaxP.gsax!==null?' · <span class="pct" style="color:'+(gsaxP.gsax>=0?'var(--green)':'var(--red)')+'" title="GSAx: goles evitados sobre lo esperado, según la zona de portería a la que fue cada tiro">GSAx '+(gsaxP.gsax>0?'+':'')+gsaxP.gsax+'</span>':'')+
        (rachaP!==null?'<br><span class="pct" style="color:'+(rachaP.tipo==='gol'?'var(--red)':'var(--green)')+'" title="Racha de '+rachaP.count+' '+(rachaP.tipo==='gol'?'goles encajados':'paradas')+' seguidas (los tiros fuera no cuentan)">'+(rachaP.tipo==='gol'?(rachaP.count>=7?'🚨':'❄️'):'🔥')+' '+rachaP.count+'</span>':'')+
      '</div>'+
      (teamPorteros(team).length>2?'<button onclick="event.stopPropagation();removePortero('+p.id+')" style="position:absolute;top:8px;left:8px;background:none;border:none;color:var(--gray);cursor:pointer;font-size:14px">✕</button>':'');
    list.appendChild(div);
    if(p.photo) setTimeout(function(){attachDrag(p.id);},10);
  });
  var add=document.createElement('button');
  add.className='add-portero-btn'; add.onclick=function(){addPortero(team);};
  add.innerHTML='<span class="plus-big">+</span><span>Añadir portero</span>';
  list.appendChild(add);
}
function editPorteroTime(pid){
  var p=porteros.find(function(x){return x.id===pid;}); if(!p) return;
  var overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center';
  var box=document.createElement('div');
  box.style.cssText='background:var(--navy2);border:1px solid var(--border);border-radius:12px;padding:24px;min-width:220px;text-align:center';
  box.innerHTML='<div style="font-family:Bebas Neue,sans-serif;font-size:18px;color:var(--gold);margin-bottom:12px">Tiempo de '+escHtml(p.name)+'</div>';
  var inp=document.createElement('input'); inp.type='text'; inp.value=fmtTime(p.seconds); inp.placeholder='MM:SS';
  inp.style.cssText='width:100%;font-size:24px;font-weight:700;color:var(--gold2);background:var(--navy3);border:1px solid var(--blue2);border-radius:8px;padding:8px;text-align:center;font-family:Bebas Neue,sans-serif;letter-spacing:2px;box-sizing:border-box;margin-bottom:12px';
  var btns=document.createElement('div'); btns.style.cssText='display:flex;gap:8px;justify-content:center';
  var bOk=document.createElement('button'); bOk.textContent='✓ Guardar';
  bOk.style.cssText='background:var(--blue2);color:#fff;border:none;border-radius:8px;padding:8px 16px;cursor:pointer;font-weight:600';
  var bCx=document.createElement('button'); bCx.textContent='✕ Cancelar';
  bCx.style.cssText='background:rgba(255,255,255,.08);color:var(--gray);border:none;border-radius:8px;padding:8px 16px;cursor:pointer';
  var close=function(){if(overlay.parentNode)overlay.parentNode.removeChild(overlay);};
  var save=function(){
    var m=inp.value.trim().match(/^(\d{1,3}):([0-5]\d)$/);
    if(!m){inp.style.borderColor='var(--red)';inp.focus();return;}
    p.seconds=parseInt(m[1])*60+parseInt(m[2]);
    close(); updateTimerDisplay(); renderPorteros();
  };
  bOk.onclick=save; bCx.onclick=close;
  overlay.onclick=function(e){if(e.target===overlay)close();};
  inp.onkeydown=function(ev){if(ev.key==='Enter')save();if(ev.key==='Escape')close();};
  btns.appendChild(bOk); btns.appendChild(bCx); box.appendChild(inp); box.appendChild(btns);
  overlay.appendChild(box); document.body.appendChild(overlay);
  setTimeout(function(){inp.select();inp.focus();},50);
}
function attachDrag(pid){
  var c=document.getElementById('pc-'+pid), img=document.getElementById('pi-'+pid);
  if(!c||!img) return;
  // El elemento es nuevo en cada render (renderPorteros hace innerHTML=''), así que
  // desenganchamos los listeners de document de la llamada anterior antes de crear otros.
  if(_dragCleanupByPid[pid]){ _dragCleanupByPid[pid](); delete _dragCleanupByPid[pid]; }
  var p=porteros.find(function(x){return x.id===pid;});
  var drag=false,sx=0,sy=0,sox=0,soy=0;
  var start=function(x,y){drag=true;sx=x;sy=y;sox=p.ox;soy=p.oy;c.classList.add('dragging');};
  var move=function(x,y){if(!drag)return;p.ox=Math.max(0,Math.min(100,sox-(x-sx)*0.5));p.oy=Math.max(0,Math.min(100,soy-(y-sy)*0.5));img.style.objectPosition=p.ox+'% '+p.oy+'%';};
  var end=function(){if(drag){drag=false;c.classList.remove('dragging');}};
  var onMouseMove=function(e){if(drag)move(e.clientX,e.clientY);};
  var onMouseUp=end;
  c.addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();start(e.clientX,e.clientY);});
  document.addEventListener('mousemove',onMouseMove);
  document.addEventListener('mouseup',onMouseUp);
  c.addEventListener('touchstart',function(e){e.stopPropagation();var t=e.touches[0];start(t.clientX,t.clientY);},{passive:true});
  c.addEventListener('touchmove',function(e){if(drag){var t=e.touches[0];move(t.clientX,t.clientY);}},{passive:true});
  c.addEventListener('touchend',end,{passive:true});
  _dragCleanupByPid[pid]=function(){
    document.removeEventListener('mousemove',onMouseMove);
    document.removeEventListener('mouseup',onMouseUp);
  };
}
function setActivePortero(id){
  if(dosEquipos){
    // Pulsar un portero lo pone en juego en su equipo Y hace que ese equipo sea el que recibe
    // el siguiente lanzamiento (así se corrige a mano cuando dos posesiones seguidas son del mismo equipo).
    var t=porteroTeam(id);
    if(t===2) activePorteroId2=id; else activePorteroId=id;
    if(equipoRecibe!==t){ equipoRecibe=t; selectedAttacker=null; renderAttackers(); }
    renderOfensiva();
  } else activePorteroId=id;
  renderPorteros();
}
function triggerPhoto(id){porteroPhotoTarget=id;document.getElementById('portero-photo-input').click();}
function addPortero(team){porteros.push({id:nextPid++,name:'Portero '+(porteros.length+1),dorsal:'',photo:null,seconds:0,ox:50,oy:20,team:team===2?2:undefined});renderPorteros();}

// ----- Modo 2 equipos de porteros: activar / desactivar / interfaz -----
function enableDosEquipos(){
  if(dosEquipos) return;
  if((scoreUs>0||(ownGoals&&ownGoals.length)) && !confirm('En el modo 2 equipos el marcador se calcula solo a partir de los goles registrados. Se pondrá a cero el marcador manual ("Nosotros"). ¿Continuar?')) return;
  dosEquipos=true; equipoRecibe=1; selectedAttacker=null;
  ownGoals=[];
  if(!teamPorteros(2).length){
    for(var i=0;i<2;i++) porteros.push({id:nextPid++,name:'Portero '+(porteros.length+1),dorsal:'',photo:null,seconds:0,ox:50,oy:20,team:2});
  }
  activePorteroId2=teamPorteros(2)[0].id;
  var t1=teamPorteros(1); if(!t1.some(function(p){return p.id===activePorteroId;})&&t1.length) activePorteroId=t1[0].id;
  applyDosUI(); recomputeScoreThem(); renderPorteros(); renderAttackers(); renderOfensiva(); renderFilterBars();
  try{ drawTimeline(getFilteredShots()); }catch(e){}
  autosaveMatchLocal();
}
function disableDosEquipos(){
  if(!dosEquipos) return;
  var ids2=teamPorteros(2).map(function(p){return p.id;});
  var usado=shots.some(function(s){return ids2.indexOf(s.porteroId)>=0||(s.porteroId==null&&s.gkTeam===2);})||otrasContribs.some(function(o){return ids2.indexOf(o.porteroId)>=0;});
  if(usado){ notify('No se puede quitar el Equipo 2: ya hay acciones registradas contra sus porteros',true); return; }
  var lanz1=attackers.filter(function(a){return a.team===1;});
  if(lanz1.length && !confirm('Se eliminarán '+lanz1.length+' lanzadores del Equipo 1. ¿Continuar?')) return;
  ids2.forEach(function(id){ if(_dragCleanupByPid[id]){ _dragCleanupByPid[id](); delete _dragCleanupByPid[id]; } });
  porteros=porteros.filter(function(p){return p.team!==2;});
  attackers=attackers.filter(function(a){return a.team!==1;});
  dosEquipos=false; equipoRecibe=1; activePorteroId2=null; selectedAttacker=null;
  scoreUs=0; document.getElementById('score-us').textContent='0';
  applyDosUI(); recomputeScoreThem(); renderPorteros(); renderAttackers(); renderOfensiva(); renderFilterBars();
  try{ drawTimeline(getFilteredShots()); }catch(e){}
  autosaveMatchLocal();
}
function setTeamName(t,v){
  teamNames[t-1]=v;
  _updateDosLabels();
  clearTimeout(setTeamName._t); setTeamName._t=setTimeout(function(){ if(currentMatchId) autosaveMatchLocal(); },800);
}
function _teamTitleHTML(t){
  return '🧤 Porteros <input class="team-name-input" id="team-name-'+t+'" value="'+escHtml(teamNames[t-1])+'" maxlength="24" placeholder="Equipo '+t+'" oninput="setTeamName('+t+',this.value)">';
}
// Etiquetas que dependen del nombre de equipo / equipo que recibe (sin tocar los inputs, para no perder el foco)
function _updateDosLabels(){
  var lu=document.getElementById('score-label-us'), lt=document.getElementById('score-label-them');
  if(lu) lu.textContent=dosEquipos?(teamNames[0]||'Equipo 1'):'Nosotros';
  if(lt) lt.textContent=dosEquipos?(teamNames[1]||'Equipo 2'):'Rival';
  var lz=document.getElementById('lanz-title');
  if(lz) lz.textContent=dosEquipos?('⚔️ Lanzadores · '+(teamNames[shooterTeam()-1]||('Equipo '+shooterTeam()))):'⚔️ Lanzadores';
}
function applyDosUI(){
  var wrap=document.getElementById('porteros-grid-wrap'), c1=document.getElementById('porteros-card'), c2=document.getElementById('porteros-card-2');
  if(wrap) wrap.classList.toggle('dos',dosEquipos);
  if(c2) c2.style.display=dosEquipos?'':'none';
  var addBtn=document.getElementById('btn-add-team2'); if(addBtn) addBtn.style.display=dosEquipos?'none':'';
  var t1=document.getElementById('porteros-title-1'), t2=document.getElementById('porteros-title-2');
  if(t1) t1.innerHTML=dosEquipos?_teamTitleHTML(1):'🧤 Porteros';
  if(t2) t2.innerHTML=_teamTitleHTML(2);
  if(dosEquipos&&c1&&c2&&wrap){
    // Reparte el ancho a partes iguales entre los dos cuadrantes de porteros (si la pestaña está visible)
    if(c1.offsetWidth&&wrap.offsetWidth){
      var w=Math.max(160,Math.min(c1.offsetWidth,(wrap.offsetWidth-200)/2));
      c1.style.width=w+'px'; c2.style.width=w+'px';
    }
  } else if(c1){
    var saved=null; try{ saved=localStorage.getItem('hk_porteros_w'); }catch(e){}
    c1.style.width=saved||'';
  }
  var sb=document.querySelector('#score-block-us .score-btns'); if(sb) sb.style.display=dosEquipos?'none':'';
  var sw=document.getElementById('btn-swap-score'); if(sw) sw.style.display=dosEquipos?'none':'';
  _updateDosLabels();
}
function removePortero(id){
  var tm=porteroTeam(id);
  if(teamPorteros(tm).length<=2){notify('Mínimo 2 porteros'+(dosEquipos?' por equipo':''),true);return;}
  // Si esta portera tenía foto y se había arrastrado alguna vez, attachDrag() dejó un
  // listener de document (mousemove/mouseup) enganchado a su pid — como el portero
  // desaparece, attachDrag(id) nunca se vuelve a llamar para ese id y esos listeners se
  // quedarían para siempre (leak real, encontrado el 2026-09-18 revisando más a fondo tras
  // el crash de memoria en tablet). Se limpian explícitamente aquí, igual que ya hace
  // attachDrag() consigo mismo en cada nueva llamada.
  if(_dragCleanupByPid[id]){ _dragCleanupByPid[id](); delete _dragCleanupByPid[id]; }
  porteros=porteros.filter(function(p){return p.id!==id;});
  if(activePorteroId===id) activePorteroId=teamPorteros(1)[0].id;
  if(dosEquipos&&activePorteroId2===id) activePorteroId2=teamPorteros(2)[0].id;
  renderPorteros();
}

// ===== ATTACKERS =====
function addAttacker(){
  var d=document.getElementById('new-dorsal').value.trim();
  var n=document.getElementById('new-attacker-name').value.trim();
  if(!d&&!n){notify('Introduce dorsal o nombre',true);return;}
  var na={id:Date.now(),dorsal:d||'?',name:n||'—'};
  if(dosEquipos) na.team=shooterTeam(); // lanzador del equipo contrario al portero que recibe ahora
  attackers.push(na);
  document.getElementById('new-dorsal').value='';
  document.getElementById('new-attacker-name').value='';
  renderAttackers(); renderFilterBars();
}
var attEditId = null;
function openAttEdit(id){
  var a=attackers.find(function(x){return x.id===id;}); if(!a) return;
  attEditId=id;
  document.getElementById('att-edit-dorsal').value=a.dorsal;
  document.getElementById('att-edit-name').value=a.name;
  document.getElementById('att-edit-overlay').classList.remove('hidden');
  setTimeout(function(){document.getElementById('att-edit-dorsal').focus();},50);
}
function closeAttEdit(){
  attEditId=null;
  document.getElementById('att-edit-overlay').classList.add('hidden');
}
function saveAttEdit(){
  var a=attackers.find(function(x){return x.id===attEditId;}); if(!a){closeAttEdit();return;}
  var d=document.getElementById('att-edit-dorsal').value.trim();
  var n=document.getElementById('att-edit-name').value.trim();
  if(d) a.dorsal=d; if(n) a.name=n;
  // Propaga el nombre/dorsal nuevo a todas las acciones ya registradas de este jugador en el partido
  var newLabel=a.dorsal+' '+a.name;
  shots.forEach(function(s){ if(s.attackerId===a.id) s.attacker=newLabel; });
  closeAttEdit(); renderAttackers(); renderFilterBars(); renderLog(); renderStats();
  if(currentMatchId) saveMatch();
}
function deleteAttEdit(){
  if(!confirm('¿Eliminar este jugador?')){return;}
  attackers=attackers.filter(function(x){return x.id!==attEditId;});
  if(selectedAttacker===attEditId) selectedAttacker=null;
  closeAttEdit(); renderAttackers(); renderFilterBars();
}
function renderAttackers(){
  var g=document.getElementById('attackers-grid'); g.innerHTML='';
  _updateDosLabels();
  var visibles=attackers.filter(attackerVisible);
  if(!visibles.length){g.innerHTML='<span style="font-size:11px;color:var(--gray);padding:4px">Añade lanzadores abajo</span>';return;}
  visibles.forEach(function(a){
    var wrap=document.createElement('div'); wrap.className='attacker-btn-wrap';
    wrap.dataset.attId=a.id;
    var b=document.createElement('button');
    b.className='attacker-btn'+(selectedAttacker===a.id?' selected':'');
    // tiny edit button overlaid inside, top-right corner via relative positioning
    b.style.position='relative';
    b.innerHTML='<span class="dorsal">'+escHtml(a.dorsal)+'</span><span class="aname">'+escHtml(a.name)+'</span>'
      +'<span class="att-inline-edit" title="Editar">✏</span>';
    b.onclick=function(e){
      if(_attDragSuppressClick){ _attDragSuppressClick=false; e.stopPropagation(); e.preventDefault(); return; }
      if(e.target.classList.contains('att-inline-edit')){
        e.stopPropagation(); openAttEdit(a.id); return;
      }
      selectedAttacker=selectedAttacker===a.id?null:a.id; renderAttackers();
    };
    wrap.appendChild(b);
    // Mantén pulsado (sin arrastrar de golpe) para reordenar; un toque rápido sigue seleccionando el jugador
    wrap.addEventListener('pointerdown', function(e){
      if(e.target.classList.contains('att-inline-edit')) return;
      _attDragStart={x:e.clientX,y:e.clientY};
      _attDragTimer=setTimeout(function(){ _attDragBegin(wrap); }, 320);
    });
    g.appendChild(wrap);
  });
}

// ===== Reordenar atacantes (arrastrar y soltar, mantén pulsado ~320ms) =====
var _attDrag=null, _attDragTimer=null, _attDragStart=null, _attDragSuppressClick=false;
function _attDragCancelTimer(){ clearTimeout(_attDragTimer); _attDragTimer=null; _attDragStart=null; }
function _attDragBegin(wrap){
  _attDrag={el:wrap, id:wrap.dataset.attId, over:null};
  wrap.classList.add('att-drag-src');
  if(navigator.vibrate) navigator.vibrate(15);
}
document.addEventListener('pointermove', function(e){
  if(_attDragTimer && _attDragStart && (Math.abs(e.clientX-_attDragStart.x)>8 || Math.abs(e.clientY-_attDragStart.y)>8)) _attDragCancelTimer();
  if(!_attDrag) return;
  var under=document.elementFromPoint(e.clientX,e.clientY);
  var target=under&&under.closest?under.closest('.attacker-btn-wrap'):null;
  if(_attDrag.over && _attDrag.over!==target) _attDrag.over.classList.remove('att-drag-over');
  _attDrag.over=(target&&target!==_attDrag.el)?target:null;
  if(_attDrag.over) _attDrag.over.classList.add('att-drag-over');
});
['pointerup','pointercancel'].forEach(function(ev){
  document.addEventListener(ev, function(){
    _attDragCancelTimer();
    if(!_attDrag) return;
    var d=_attDrag; _attDrag=null;
    d.el.classList.remove('att-drag-src');
    if(d.over) d.over.classList.remove('att-drag-over');
    _attDragSuppressClick=true; // evita que el toque al soltar seleccione o abra el editor
    var targetId=d.over?d.over.dataset.attId:null;
    if(!targetId || String(targetId)===String(d.id)) return;
    reorderAttackers(d.id, targetId);
  });
});
function reorderAttackers(draggedId, targetId){
  var i=attackers.findIndex(function(x){return String(x.id)===String(draggedId);});
  var j0=attackers.findIndex(function(x){return String(x.id)===String(targetId);});
  if(i<0||j0<0) return;
  var moved=attackers.splice(i,1)[0];
  var j=attackers.findIndex(function(x){return String(x.id)===String(targetId);});
  attackers.splice(i<j0?j+1:j,0,moved);
  renderAttackers(); renderFilterBars();
  _syncAttackersOrderToRivalTeam();
  notify('↕ Orden actualizado');
}
// Si el rival actual coincide con un equipo guardado en el directorio, refleja el nuevo
// orden (y los dorsales corregidos) en su ficha para que la próxima importación ya venga así.
function _syncAttackersOrderToRivalTeam(){
  if(dosEquipos) return; // con 2 equipos no hay un único "rival" al que asociar el orden
  var rivalNameEl=document.getElementById('rival-name');
  var rivalName=rivalNameEl?rivalNameEl.value.trim():'';
  if(!rivalName) return;
  var rfs=_rivalsFSCache; if(!rfs) return;
  var team=rfs.teams.find(function(t){return t.name.trim().toLowerCase()===rivalName.toLowerCase();});
  if(!team) return;
  var byName={};
  (team.players||[]).forEach(function(p){ byName[(p.name||'').trim().toLowerCase()]=p; });
  var reordered=[];
  attackers.forEach(function(a){
    var key=(a.name||'').trim().toLowerCase();
    var p=byName[key];
    if(p){ p.dorsal=a.dorsal; reordered.push(p); delete byName[key]; }
    else reordered.push({dorsal:a.dorsal, name:a.name});
  });
  Object.keys(byName).forEach(function(k){ reordered.push(byName[k]); }); // suplentes no usados hoy, al final
  team.players=reordered;
  team.updatedAt=Date.now(); // updatedAt: para que la fusión con la nube sepa que este es el cambio más reciente
  saveRivalsFS2(rfs);
}


// ===== DIRECTORIO DE EQUIPOS RIVALES =====
// Stored in IndexedDB key 'hb_rivals6': {folders:[{id,name,parentId,order}], teams:[{id,name,players:[{dorsal,name}],parentId,order}]}

var _rivalsFSCache = null;
function saveRivalsFS2(rfs){
  _rivalsFSCache = rfs; _idbSet('hb_rivals6', rfs);
  _fbSyncRivals(rfs); // fusiona con la nube antes de escribir (ver _fbSyncRivals más arriba)
}

var _rivalsDirFolder = null; // current folder id (null = root)
var _rivalsDrag = null, _rivalsDragActive = false;



function openRivalsDir(){
  // Use synchronous cache — show overlay immediately, no IDB async wait
  var rfs = _rivalsFSCache || {folders:[], teams:[]};
  // Auto-import rivals from match history not yet in directory
  var fs = loadFS();
  var known = {};
  rfs.teams.forEach(function(t){ known[t.name.trim().toLowerCase()] = true; });
  fs.files.forEach(function(f){
    if(!f.data || !f.data.rival) return;
    var name = f.data.rival.trim();
    if(!name || known[name.toLowerCase()]) return;
    var rivals = fs.files.filter(function(x){
      return x.data && x.data.rival &&
             x.data.rival.trim().toLowerCase() === name.toLowerCase() &&
             x.data.attackers && x.data.attackers.length;
    });
    if(!rivals.length) return;
    rivals.sort(function(a,b){ return new Date(b.data.date||0) - new Date(a.data.date||0); });
    var best = rivals[0];
    rfs.teams.push({
      id: Date.now() + Math.random(),
      name: name,
      players: (best.data.attackers||[]).map(function(a){ return {dorsal:a.dorsal||'',name:a.name||'—'}; }),
      parentId: null,
      order: rfs.teams.length,
      updatedAt: Date.now()
    });
    known[name.toLowerCase()] = true;
  });
  saveRivalsFS2(rfs); // antes solo se guardaba en local; ahora también se fusiona/sube
  _rivalsDirFolder = null;
  renderRivalsDir();
  document.getElementById('rivals-dir-overlay').classList.remove('hidden');
}


function closeRivalsDir(){
  document.getElementById('rivals-dir-overlay').classList.add('hidden');
}

function rivalsDirUp(){
  var rfs = _rivalsFSCache || {folders:[],teams:[]};
  var f = rfs.folders.find(function(x){ return x.id === _rivalsDirFolder; });
  _rivalsDirFolder = f ? f.parentId : null;
  renderRivalsDir();
}

function restoreRivalsTrashItem(trashId){
  var rfs = _rivalsFSCache || {folders:[],teams:[]};
  rfs.trash = rfs.trash || [];
  var idx = rfs.trash.findIndex(function(t){return t.id===trashId;});
  if(idx===-1) return;
  var entry = rfs.trash[idx];
  if(entry.type==='team'){
    rfs.teams.push(entry.data.team);
  } else {
    var folder = entry.data.folder;
    if(folder.parentId!==null && !rfs.folders.some(function(f){return f.id===folder.parentId;})){
      folder.parentId = null;
    }
    rfs.folders.push(folder);
    (entry.data.folders||[]).forEach(function(f){ rfs.folders.push(f); });
    (entry.data.teams||[]).forEach(function(t){ rfs.teams.push(t); });
  }
  rfs.trash.splice(idx,1);
  saveRivalsFS2(rfs); renderRivalsDir();
  try{ renderTrash(); }catch(e){}
  notify('♻️ Restaurado');
}
function purgeRivalsTrashItemNow(trashId){
  if(!confirm('¿Eliminar definitivamente? No podrás recuperarlo después.')) return;
  var rfs = _rivalsFSCache || {folders:[],teams:[]};
  rfs.trash = rfs.trash || [];
  var idx = rfs.trash.findIndex(function(t){return t.id===trashId;});
  if(idx===-1) return;
  rfs.trash.splice(idx,1);
  saveRivalsFS2(rfs);
  try{ renderTrash(); }catch(e){}
  notify('🗑 Eliminado definitivamente');
}
function _purgeOldRivalsTrash(){
  var rfs = _rivalsFSCache || {folders:[],teams:[]};
  var now=Date.now(), kept=[];
  (rfs.trash||[]).forEach(function(entry){
    if(now - entry.deletedAt <= TRASH_RETENTION_MS) kept.push(entry);
  });
  if(kept.length !== (rfs.trash||[]).length){
    rfs.trash = kept;
    saveRivalsFS2(rfs);
  }
}

function renderRivalsDir(){
  var rfs = _rivalsFSCache || {folders:[],teams:[]};
  var grid = document.getElementById('rivals-dir-grid');
  grid.innerHTML = '';

  // Breadcrumb
  var bc = document.getElementById('rivals-breadcrumb');
  bc.innerHTML = '';
  var btnUp = document.getElementById('rivals-btn-up');
  if(_rivalsDirFolder === null){
    bc.innerHTML = '<span style="color:var(--text)">Equipos Rivales</span>';
    btnUp.disabled = true; btnUp.style.opacity = '.35';
  } else {
    var path = [], cur = _rivalsDirFolder;
    while(cur !== null){
      var fnd = rfs.folders.find(function(x){ return x.id === cur; });
      if(!fnd) break; path.unshift(fnd); cur = fnd.parentId;
    }
    var home = document.createElement('span');
    home.style.cssText = 'cursor:pointer;color:var(--blue2)';
    home.textContent = 'Inicio';
    home.onclick = function(){ _rivalsDirFolder = null; renderRivalsDir(); };
    bc.appendChild(home);
    path.forEach(function(p){
      bc.appendChild(document.createTextNode(' › '));
      var sp = document.createElement('span');
      sp.style.cssText = 'cursor:pointer;color:var(--blue2)';
      sp.textContent = p.name;
      sp.onclick = (function(pid){ return function(){ _rivalsDirFolder = pid; renderRivalsDir(); }; })(p.id);
      bc.appendChild(sp);
    });
    btnUp.disabled = false; btnUp.style.opacity = '1';
  }

  // Folders
  var folders = rfs.folders.filter(function(f){ return f.parentId === _rivalsDirFolder; });
  folders.sort(function(a,b){ return (a.order||0)-(b.order||0); });
  folders.forEach(function(folder){
    var el = document.createElement('div');
    el.style.cssText = 'background:var(--navy2);border:1px solid var(--border);border-radius:10px;padding:12px;cursor:pointer;display:flex;flex-direction:column;align-items:flex-start;gap:6px;transition:border-color .15s;position:relative';
    el.setAttribute('data-folder-id', folder.id);
    el.setAttribute('data-folder-name', folder.name);
    el.dataset.folderId = folder.id;
    el.dataset.folderName = folder.name;
    el.innerHTML = '<div style="font-size:24px">📁</div><div style="font-size:13px;font-weight:600;color:var(--white);word-break:break-word">' + escHtml(folder.name) + '</div>';
    el.onclick = function(){ _rivalsDirFolder = folder.id; renderRivalsDir(); };

    // Rename / delete buttons
    var acts = document.createElement('div');
    acts.style.cssText = 'position:absolute;top:6px;right:6px;display:flex;gap:4px';
    var renBtn = document.createElement('button');
    renBtn.className = 'btn-dir'; renBtn.style.cssText = 'font-size:10px;padding:3px 6px';
    renBtn.textContent = '✏'; renBtn.title = 'Renombrar';
    renBtn.onclick = (function(fid, fname){ return function(e){ e.stopPropagation();
      var n = prompt('Nuevo nombre:', fname); if(!n || !n.trim()) return;
      var rfs2 = _rivalsFSCache; var f2 = rfs2.folders.find(function(x){ return x.id===fid; });
      if(f2){ f2.name = n.trim(); f2.updatedAt=Date.now(); saveRivalsFS2(rfs2); renderRivalsDir(); }
    }; })(folder.id, folder.name);
    var delBtn = document.createElement('button');
    delBtn.className = 'btn-dir'; delBtn.style.cssText = 'font-size:10px;padding:3px 6px';
    delBtn.textContent = '🗑'; delBtn.title = 'Eliminar';
    delBtn.onclick = (function(folderRef){ return function(e){ e.stopPropagation();
      var rfs2 = _rivalsFSCache;
      // Recorrido recursivo del subárbol completo (antes solo borraba un nivel: una
      // carpeta anidada dos niveles dejaba huérfanos invisibles sus nietos).
      var toDelete={}; var stack=[folderRef.id];
      while(stack.length){ var cur=stack.pop(); toDelete[cur]=true; rfs2.folders.forEach(function(f){if(f.parentId===cur) stack.push(f.id);}); }
      var removedFolders = rfs2.folders.filter(function(f){return toDelete[f.id] && f.id!==folderRef.id;});
      var removedTeams = rfs2.teams.filter(function(t){return toDelete[t.parentId];});
      var nF=removedFolders.length, nE=removedTeams.length;
      var detalle=[nE&&(nE+' equipo'+(nE!==1?'s':'')), nF&&(nF+' subcarpeta'+(nF!==1?'s':''))].filter(Boolean).join(' y ')||'vacía';
      if(!confirm('¿Eliminar "'+folderRef.name+'" ('+detalle+')?\nPodrás recuperarla desde la Papelera durante 30 días.')) return;
      rfs2.folders = rfs2.folders.filter(function(f){return !toDelete[f.id];});
      rfs2.teams = rfs2.teams.filter(function(t){return !toDelete[t.parentId];});
      rfs2.trash = rfs2.trash || [];
      rfs2.trash.push({id:_trashId(), type:'folder', name:folderRef.name, deletedAt:Date.now(), data:{folder:folderRef, folders:removedFolders, teams:removedTeams}});
      saveRivalsFS2(rfs2); renderRivalsDir();
    }; })(folder);
    acts.appendChild(renBtn); acts.appendChild(delBtn); el.appendChild(acts);
    grid.appendChild(el);
  });

  // Teams
  var teams = rfs.teams.filter(function(t){ return t.parentId === _rivalsDirFolder; });
  teams.sort(function(a,b){ return (a.order||0)-(b.order||0); });
  if(!folders.length && !teams.length){
    var empty = document.createElement('div');
    empty.style.cssText = 'grid-column:1/-1;color:var(--gray);font-size:13px;text-align:center;padding:30px';
    empty.textContent = 'Carpeta vacía. Usa "Nuevo equipo" para añadir uno.';
    grid.appendChild(empty);
  }
  teams.forEach(function(team){
    var el = document.createElement('div');
    el.style.cssText = 'background:var(--navy2);border:1px solid var(--border);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:6px;position:relative;transition:border-color .15s;cursor:grab;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:none';
    // Touch drag: activa en cuanto el dedo se mueve >10px

    // Photo (opcional, se sincroniza entre dispositivos igual que la foto de portero)
    var teamPhoto = getTeamPhoto(team.id);
    if(!teamPhoto) ensureTeamPhoto(team.id);
    var photoEl = document.createElement('div');
    photoEl.title = 'Cambiar foto del equipo';
    photoEl.onclick = function(e){ e.stopPropagation(); triggerRivalPhoto(team.id); };
    if(teamPhoto){
      photoEl.style.cssText = 'width:44px;height:44px;border-radius:50%;overflow:hidden;cursor:pointer;border:2px solid var(--border)';
      photoEl.innerHTML = '<img src="'+teamPhoto+'" style="width:100%;height:100%;object-fit:cover;display:block" draggable="false">';
    } else {
      photoEl.style.cssText = 'width:44px;height:44px;border-radius:50%;border:2px dashed rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;color:rgba(255,255,255,.2)';
      photoEl.textContent = '🛡';
    }
    el.appendChild(photoEl);

    // Name
    var nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-family:Bebas Neue,sans-serif;font-size:16px;color:var(--gold);letter-spacing:.5px;padding-right:44px;word-break:break-word';
    nameEl.textContent = team.name;
    el.appendChild(nameEl);
    // Players preview
    var pcount = (team.players||[]).length;
    var prev = document.createElement('div');
    prev.style.cssText = 'font-size:11px;color:var(--gray)';
    prev.textContent = pcount ? pcount + ' jugador' + (pcount!==1?'es':'') : 'Sin jugadores';
    el.appendChild(prev);
    // Import button
    var imp = document.createElement('button');
    imp.className = 'tbtn';
    imp.style.cssText = 'width:100%;font-size:11px;margin-top:4px';
    imp.textContent = pcount ? '✓ Importar jugadores' : '— Sin jugadores';
    imp.disabled = !pcount;
    imp.onclick = (function(t){ return function(e){ e.stopPropagation(); importRivalTeam(t); }; })(team);
    el.appendChild(imp);
    // Action buttons
    var acts = document.createElement('div');
    acts.style.cssText = 'position:absolute;top:6px;right:6px;display:flex;gap:3px';
    var editBtn = document.createElement('button');
    editBtn.className = 'btn-dir';
    editBtn.style.cssText = 'font-size:11px;padding:3px 7px;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;line-height:1';
    editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor" style="display:block"><path d="M10 0 L7 4 L9 4 L9 9 L4 9 L4 7 L0 10 L4 13 L4 11 L9 11 L9 16 L7 16 L10 20 L13 16 L11 16 L11 11 L16 11 L16 13 L20 10 L16 7 L16 9 L11 9 L11 4 L13 4 Z"/></svg>';
    editBtn.title = 'Arrastrar a carpeta';
    editBtn.addEventListener('pointerdown', (function(tid, tname){ return function(e){
      e.stopPropagation();
      editBtn.setPointerCapture(e.pointerId);
      _rivalsDrag = {id:tid, name:tname, el:el};
      _rivalsDragActive = true;
      el.style.opacity = '0.55';
      el.style.boxShadow = '0 0 0 2px var(--gold)';
      editBtn.style.cursor = 'grabbing';
    }; })(team.id, team.name));
    editBtn.addEventListener('pointermove', (function(){ return function(e){
      if(!_rivalsDragActive || !_rivalsDrag) return;
      // Hide card briefly to find what's underneath
      el.style.visibility = 'hidden';
      var under = document.elementFromPoint(e.clientX, e.clientY);
      el.style.visibility = '';
      var folderEl = under && under.closest ? under.closest('[data-folder-id]') : null;
      document.querySelectorAll('[data-folder-id]').forEach(function(f){
        var active = folderEl && f === folderEl;
        f.style.borderColor = active ? 'var(--gold)' : 'var(--border)';
        f.style.background  = active ? 'rgba(245,158,11,.12)' : 'var(--navy2)';
      });
    }; })());
    editBtn.addEventListener('pointerup', (function(tid, tname){ return function(e){
      if(!_rivalsDragActive){ _rivalsDrag=null; return; }
      el.style.opacity = ''; el.style.boxShadow = '';
      editBtn.style.cursor = 'grab';
      document.querySelectorAll('[data-folder-id]').forEach(function(f){
        f.style.borderColor='var(--border)'; f.style.background='var(--navy2)';
      });
      el.style.visibility = 'hidden';
      var under = document.elementFromPoint(e.clientX, e.clientY);
      el.style.visibility = '';
      var folderEl = under && under.closest ? under.closest('[data-folder-id]') : null;
      if(folderEl){
        var fid   = folderEl.getAttribute('data-folder-id');
        var fname = folderEl.getAttribute('data-folder-name');
        if(String(tid) !== String(fid)){
          if(confirm('¿Quieres mover "' + tname + '" a "' + fname + '"?')){
            var rfs2 = _rivalsFSCache || {folders:[],teams:[]};
            var team2 = rfs2.teams.find(function(t2){ return String(t2.id)===String(tid); });
            if(team2){ team2.parentId = isNaN(fid) ? fid : Number(fid); team2.updatedAt=Date.now(); saveRivalsFS2(rfs2); renderRivalsDir(); }
          }
        }
      }
      _rivalsDragActive = false; _rivalsDrag = null;
    }; })(team.id, team.name));
    var delBtn = document.createElement('button');
    delBtn.className = 'btn-dir'; delBtn.style.cssText = 'font-size:10px;padding:3px 6px';
    delBtn.textContent = '🗑'; delBtn.title = 'Eliminar';
    delBtn.onclick = (function(teamRef){ return function(e){ e.stopPropagation();
      if(!confirm('¿Eliminar "'+teamRef.name+'" del directorio?\nPodrás recuperarlo desde la Papelera durante 30 días. La foto del equipo, si tenía, no se recupera.')) return;
      var rfs2 = _rivalsFSCache; rfs2.teams = rfs2.teams.filter(function(x){ return x.id!==teamRef.id; });
      rfs2.trash = rfs2.trash || [];
      rfs2.trash.push({id:_trashId(), type:'team', name:teamRef.name, deletedAt:Date.now(), data:{team:teamRef}});
      saveRivalsFS2(rfs2);
      if(_teamPhotoCache[teamRef.id]){ delete _teamPhotoCache[teamRef.id]; _idbSet('hb_team_photos', _teamPhotoCache); }
      _deletePhoto('equipo', teamRef.id);
      renderRivalsDir();
    }; })(team);
    acts.appendChild(editBtn); acts.appendChild(delBtn); el.appendChild(acts);
    grid.appendChild(el);
  });
}

function importRivalTeam(team){
  if(!team.players || !team.players.length) return;
  var mine = attackers.filter(attackerVisible);
  if(mine.length > 0){
    if(!confirm('Ya hay ' + mine.length + ' lanzadores. ¿Sustituirlos por los de ' + team.name + '?')) return;
  }
  document.getElementById('rival-name').value = team.name;
  var st = shooterTeam();
  // En modo 2 equipos solo se sustituyen los lanzadores del equipo visible; los del otro se conservan
  attackers = attackers.filter(function(a){ return !attackerVisible(a); }).concat(team.players.map(function(p){
    var na = {id: Date.now()+Math.random(), dorsal: p.dorsal||'?', name: p.name||'—'};
    if(dosEquipos) na.team = st;
    return na;
  }));
  renderAttackers();
  closeRivalsDir();
  notify('✓ Equipo ' + team.name + ' importado');
}

function rivalsDirNewFolder(){
  var name = prompt('Nombre de la carpeta:');
  if(!name || !name.trim()) return;
  var rfs = _rivalsFSCache || {folders:[],teams:[]};
  rfs.folders.push({id: Date.now()+Math.random(), name: name.trim(), parentId: _rivalsDirFolder, order: rfs.folders.length, updatedAt: Date.now()});
  saveRivalsFS2(rfs); renderRivalsDir();
}

function rivalsDirNewTeam(){
  var name = prompt('Nombre del equipo:');
  if(!name || !name.trim()) return;
  var rfs = _rivalsFSCache || {folders:[],teams:[]};
  rfs.teams.push({id: Date.now()+Math.random(), name: name.trim(), players:[], parentId: _rivalsDirFolder, order: rfs.teams.length, updatedAt: Date.now()});
  saveRivalsFS2(rfs); renderRivalsDir();
}

// Load rivals cache on startup
(function(){ _idbGet('hb_rivals6', function(v){ _rivalsFSCache = v || {folders:[],teams:[]}; }); })();

// ===== RESIZABLE PORTEROS/RIVAL DIVIDER =====
(function(){
  var STORE_KEY='hk_porteros_w';
  function initDivider(){
    var wrap=document.getElementById('porteros-grid-wrap');
    var pCard=document.getElementById('porteros-card');
    var pCard2=document.getElementById('porteros-card-2');
    var divider=document.getElementById('porteros-divider');
    if(!wrap||!pCard||!divider) return;
    // Restore saved width
    var saved=localStorage.getItem(STORE_KEY);
    if(saved) pCard.style.width=saved;
    var dragging=false, startX=0, startW=0;
    function onStart(clientX){
      dragging=true; startX=clientX; startW=pCard.offsetWidth;
      divider.classList.add('dragging');
      document.body.style.cursor='col-resize';
      document.body.style.userSelect='none';
    }
    function onMove(clientX){
      if(!dragging) return;
      var dx=clientX-startX;
      var maxW=wrap.classList.contains('dos')?(wrap.offsetWidth-200)/2:wrap.offsetWidth-180;
      var newW=Math.min(Math.max(startW+dx, 160), Math.max(160,maxW));
      pCard.style.width=newW+'px';
      if(pCard2&&wrap.classList.contains('dos')) pCard2.style.width=newW+'px'; // los dos cuadrantes de porteros van iguales
    }
    function onEnd(){
      if(!dragging) return;
      dragging=false;
      divider.classList.remove('dragging');
      document.body.style.cursor='';
      document.body.style.userSelect='';
      localStorage.setItem(STORE_KEY, pCard.style.width);
    }
    // Mouse
    divider.addEventListener('mousedown', function(e){ e.preventDefault(); onStart(e.clientX); });
    document.addEventListener('mousemove', function(e){ onMove(e.clientX); });
    document.addEventListener('mouseup', onEnd);
    // Touch
    divider.addEventListener('touchstart', function(e){ onStart(e.touches[0].clientX); }, {passive:true});
    document.addEventListener('touchmove', function(e){ if(dragging){ e.preventDefault(); onMove(e.touches[0].clientX); } }, {passive:false});
    document.addEventListener('touchend', onEnd, {passive:true});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', initDivider);
  else initDivider();
})();

// ===== TRAJ FILTER IN STATS =====
function setGoalPosFilter(pos){
  statsGoalPosFilter = (statsGoalPosFilter===pos) ? null : pos;
  renderStats();
  try{drawTimeline(getFilteredShots());}catch(e){}
}
function setStatsTrajFilter(traj){
  statsTrajFilter = traj;
  var all=document.getElementById('traj-f-all');
  var bx =document.getElementById('traj-f-x');
  var bl =document.getElementById('traj-f-l');
  if(all) all.style.background = !traj       ? 'var(--blue)' : 'transparent';
  if(bx)  bx.style.background  = traj==='cruzado'  ? 'rgba(239,68,68,.25)'  : 'transparent';
  if(bl)  bl.style.background  = traj==='paralelo' ? 'rgba(34,197,94,.25)' : 'transparent';
  renderStats();
  try{drawTimeline(getFilteredShots());}catch(e){}
}

// ===== ZONE & GOAL =====
function selectZoneSVG(btn){
  document.querySelectorAll('[data-zone]').forEach(function(b){
    var sp=b.dataset.zone==='7 metros'||b.dataset.zone==='Contraataque';
    b.style.background=sp?'rgba(120,70,0,.4)':'rgba(15,40,90,.75)';
    b.style.borderColor=sp?'rgba(245,158,11,.9)':'rgba(255,255,255,.5)';
    b.style.color=sp?'#fbbf24':'#fff'; b.style.boxShadow='none';
  });
  btn.style.background='rgba(30,80,200,.9)'; btn.style.borderColor='#93c5fd';
  btn.style.color='#fff'; btn.style.boxShadow='0 0 10px rgba(147,197,253,.5)';
  selectedZone=btn.dataset.zone;
  var lbl=document.getElementById('zone-active-lbl'); if(lbl) lbl.textContent='✓ '+selectedZone;
  checkReady();
}
function selectGoalSVG(btn){
  document.querySelectorAll('.gcell').forEach(function(b){b.style.background=b.classList.contains('gcell-fuera')?'rgba(239,68,68,.10)':'rgba(255,255,255,.06)';b.style.boxShadow='none';});
  btn.style.background='rgba(37,99,235,.62)'; btn.style.boxShadow='0 0 10px rgba(147,197,253,.38)';
  selectedGoalPos=btn.dataset.pos;
  var lbl=document.getElementById('goal-active-lbl'); if(lbl) lbl.textContent='✓ '+selectedGoalPos;
  // Elegir una zona "fuera" solo tiene sentido si el resultado también es "fuera" — se
  // preselecciona el botón de resultado para no obligar a un segundo clic, y para que
  // sea imposible guardar sin querer una zona "fuera" junto a un resultado de gol/parada.
  if(btn.classList.contains('gcell-fuera')){
    var fb=document.getElementById('btn-result-fuera');
    if(fb) selectResult('fuera', fb);
  }
  checkReady();
}
function selectResult(r,btn){
  document.querySelectorAll('.btn-result').forEach(function(b){b.classList.remove('selected');});
  btn.classList.add('selected'); selectedResult=r; checkReady();
}
function checkReady(){
  document.getElementById('register-btn').disabled=!(selectedZone&&selectedGoalPos&&selectedResult);
}

// ===== REGISTER SHOT =====
function setStatsZoneFilter(zone, tr){
  // Toggle filter
  if(statsZoneFilter===zone){statsZoneFilter=null;}else{statsZoneFilter=zone;}
  var groupMap={'9m total':['Lateral izq','Central','Lateral der'],'6m total':['6m izq','6m cent','6m der'],'Extremos':['Extremo izq','Extremo der']};
  var fs=getFilteredShots();
  var filtered=statsZoneFilter?(function(){
    var gz=groupMap[statsZoneFilter]||[statsZoneFilter];
    return fs.filter(function(s){return gz.indexOf(s.zone)>=0;});
  })():fs;
  // Update row highlight — find row by zone text if tr not provided (e.g. from radar click)
  // (se salta la fila de "Con habilidad", que gestiona su propio resaltado aparte)
  var tbody=document.getElementById('zone-table-body');
  if(tbody) Array.from(tbody.querySelectorAll('tr')).forEach(function(r){
    if(r.dataset.hab) return;
    var isMatch = statsZoneFilter && (r===tr || (r.cells[0]&&r.cells[0].textContent.trim()===statsZoneFilter));
    r.style.background = isMatch ? 'rgba(99,102,241,.18)' : '';
    r.style.outline    = isMatch ? '1px solid rgba(99,102,241,.5)' : '';
  });
  // Redraw all affected charts
  drawGoalHeatmap(filtered);
  try{drawRadar(filtered);}catch(e){}
  // Update timeline with shot markers
  try{drawTimeline(fs);}catch(e){}
}
// A diferencia del filtro de zona (que solo recorta gráficos), "habilidad" filtra
// como cualquier otro filtro global (portero/jugador/zona de gol/trayectoria):
// afecta también a la tabla y los contadores, por eso aquí sí se rehace todo con renderStats().
function setStatsHabFilter(){
  statsHabFilter=!statsHabFilter;
  renderStats();
}
function drawGoalHeatmap(shotsArr){
  var cells=[
    {pos:'Alto izq',x:58,y:52,w:114,h:65},{pos:'Alto centro',x:176,y:52,w:116,h:65},{pos:'Alto der',x:296,y:52,w:114,h:65},
    {pos:'Medio izq',x:58,y:121,w:114,h:63},{pos:'Centro',x:176,y:121,w:116,h:63},{pos:'Medio der',x:296,y:121,w:114,h:63},
    {pos:'Bajo izq',x:58,y:188,w:114,h:58},{pos:'Bajo centro',x:176,y:188,w:116,h:58},{pos:'Bajo der',x:296,y:188,w:114,h:58}
  ];
  // Zonas "fuera" (mismas coordenadas que #goal-svg de registro): solo cuentan tiros, sin
  // save%/GSAx (no hay parada posible fuera de la portería) — así esos tiros dejan de
  // quedar invisibles en este resumen en vez de perderse.
  var cellsFuera=[
    {pos:'Fuera alto izq',x:12,y:52,w:24,h:65},{pos:'Fuera medio izq',x:12,y:121,w:24,h:63},{pos:'Fuera bajo izq',x:12,y:188,w:24,h:58},
    {pos:'Fuera alto der',x:432,y:52,w:24,h:65},{pos:'Fuera medio der',x:432,y:121,w:24,h:63},{pos:'Fuera bajo der',x:432,y:188,w:24,h:58},
    {pos:'Fuera arriba izq',x:58,y:12,w:114,h:24},{pos:'Fuera arriba centro',x:176,y:12,w:116,h:24},{pos:'Fuera arriba der',x:296,y:12,w:114,h:24}
  ];
  var gcSvg=document.getElementById('goal-stats-svg');
  if(!gcSvg) return;
  var gsaxZ=gsaxPorZona(shotsArr, null).porZona;
  var dyn='';
  cells.forEach(function(c){
    var sz=shotsArr.filter(function(s){return s.goalPos===c.pos;});
    var pr=sz.filter(function(s){return s.result==='parada';}).length;
    var lz=sz.filter(function(s){return s.result!=='fuera'&&!s.noGk;}).length;
    var pp=lz>0?Math.round(pr/lz*100):null;
    var tc=pctColor(pp); var fill=pp===null?'rgba(255,255,255,.04)':tc+'33';
    dyn+='<rect x="'+c.x+'" y="'+c.y+'" width="'+c.w+'" height="'+c.h+'" fill="'+fill+'" rx="3" style="cursor:pointer" onclick="setGoalPosFilter(\'' + c.pos + '\')"/>';
    if(lz>0){
      dyn+='<text x="'+(c.x+c.w/2)+'" y="'+(c.y+c.h/2-9)+'" text-anchor="middle" fill="'+tc+'" font-size="14" font-weight="700">'+pr+'/'+lz+'</text>';
      dyn+='<text x="'+(c.x+c.w/2)+'" y="'+(c.y+c.h/2+6)+'" text-anchor="middle" fill="'+tc+'" font-size="10">'+(pp!==null?pp+'%':'—')+'</text>';
      var zd=gsaxZ[c.pos];
      if(zd && zd.tiros>0){
        var dc=zd.diferencia>=0?'#22c55e':'#ef4444';
        dyn+='<text x="'+(c.x+c.w/2)+'" y="'+(c.y+c.h/2+17)+'" text-anchor="middle" fill="'+dc+'" font-size="9" font-weight="600">GSAx '+(zd.diferencia>0?'+':'')+zd.diferencia+'</text>';
      }
    }
  });
  cellsFuera.forEach(function(c){
    var n=shotsArr.filter(function(s){return s.goalPos===c.pos;}).length;
    dyn+='<rect x="'+c.x+'" y="'+c.y+'" width="'+c.w+'" height="'+c.h+'" fill="rgba(239,68,68,.10)" stroke="rgba(239,68,68,.35)" stroke-width="1" stroke-dasharray="3 2" rx="3" style="cursor:pointer" onclick="setGoalPosFilter(\'' + c.pos + '\')"/>';
    if(n>0){
      dyn+='<text x="'+(c.x+c.w/2)+'" y="'+(c.y+c.h/2+4)+'" text-anchor="middle" fill="#f87171" font-size="12" font-weight="700">'+n+'</text>';
    }
  });
  var gcG=document.getElementById('goal-stats-cells');
  if(gcG) gcG.innerHTML=dyn;
}
function toggleHab(btn){
  selectedHab=!selectedHab;
  btn.style.background=selectedHab?'rgba(168,85,247,.25)':'transparent';
}
function toggleNoGk(btn){
  selectedNoGk=!selectedNoGk;
  btn.style.background=selectedNoGk?'rgba(156,163,175,.3)':'transparent';
  // Sin portero no hay parada posible: si estaba seleccionada, se desmarca
  var pb=document.getElementById('btn-result-parada');
  if(pb){
    pb.style.opacity=selectedNoGk?'.35':'1';
    pb.style.pointerEvents=selectedNoGk?'none':'auto';
    if(selectedNoGk && selectedResult==='parada'){
      selectedResult=null; pb.classList.remove('selected'); checkReady();
    }
  }
}
function toggleDeflected(btn){
  selectedDeflected=!selectedDeflected;
  btn.style.background=selectedDeflected?'rgba(56,189,248,.25)':'transparent';
}
function toggleRebote(btn){
  selectedRebote=!selectedRebote;
  btn.style.background=selectedRebote?'rgba(245,158,11,.25)':'transparent';
}
function togglePfPd(type,btn){
  if(selectedPfPd===type){selectedPfPd=null;}else{selectedPfPd=type;}
  var bpf=document.getElementById('btn-pf');
  var bpd=document.getElementById('btn-pd');
  if(bpf)bpf.style.background=selectedPfPd==='pf'?'rgba(34,197,94,.25)':'transparent';
  if(bpd)bpd.style.background=selectedPfPd==='pd'?'rgba(239,68,68,.25)':'transparent';
}
function registerShot(){
  var recvId=receivingPid();
  var p=porteros.find(function(x){return x.id===recvId;});
  var a=attackers.find(function(x){return x.id===selectedAttacker;});
  // auto-score (con 2 equipos se recalcula abajo, según el equipo del portero que recibe el gol)
  if(selectedResult==='gol'&&!dosEquipos){
    scoreThem=scoreThem+1; document.getElementById('score-them').textContent=scoreThem;
  }
  shots.push({
    id:Date.now(), time:fmtTime(timerSeconds),
    videoSeconds:_syncRealSeconds()||0, // segundo del reloj de vídeo real, para exportar a XPS sin tener que calibrar
    porteroId:selectedNoGk?null:recvId,
    gkTeam:(dosEquipos&&selectedNoGk)?equipoRecibe:undefined, // portería vacía: qué equipo defendía
    porteroName:selectedNoGk?'Sin portero':(p?p.name:'—'),
    attackerId:selectedAttacker||null, attacker:a?a.dorsal+' '+a.name:'—',
    zone:selectedZone, goalPos:selectedGoalPos, result:selectedResult,
    pf:selectedPfPd==='pf'?true:undefined, pd:selectedPfPd==='pd'?true:undefined,
    hab:selectedHab?true:undefined,
    traj:selectedTraj||undefined,
    noGk:selectedNoGk?true:undefined,
    deflected:selectedDeflected?true:undefined,
    rebote:selectedRebote?true:undefined
  });
  // Reset PF/PD/HAB/SP/Desviado/Rebote after registering
  selectedPfPd=null; selectedHab=false; selectedTraj=null; selectedNoGk=false; selectedDeflected=false; selectedRebote=false;
  var bx=document.getElementById('btn-traj-x'); var bl=document.getElementById('btn-traj-l');
  if(bx)bx.style.background='transparent'; if(bl)bl.style.background='transparent';
  var bpf=document.getElementById('btn-pf');var bpd=document.getElementById('btn-pd');var bhab=document.getElementById('btn-hab');var bng=document.getElementById('btn-nogk');var bdf=document.getElementById('btn-deflected');var brb=document.getElementById('btn-rebote');
  if(bpf)bpf.style.background='transparent';
  if(bpd)bpd.style.background='transparent';
  if(bhab)bhab.style.background='transparent';
  if(bng)bng.style.background='transparent';
  if(bdf)bdf.style.background='transparent';
  if(brb)brb.style.background='transparent';
  var pb=document.getElementById('btn-result-parada');
  if(pb){ pb.style.opacity='1'; pb.style.pointerEvents='auto'; }
  if(dosEquipos){
    recomputeScoreThem();
    // Tras un lanzamiento lo normal es que cambie la posesión: el siguiente lo recibe el otro equipo
    // (se puede corregir a mano pulsando un portero). Sus lanzadores son otros, así que se limpia la selección.
    equipoRecibe=equipoRecibe===1?2:1; selectedAttacker=null;
    renderAttackers(); renderOfensiva();
  }
  renderLog(); renderStats(); renderPorteros(); renderFilterBars();
  notify(selectedResult==='parada'?'✅ Parada':selectedResult==='gol'?'⚽ Gol encajado':'↗ Fuera');
  selectedResult=null;
  document.querySelectorAll('.btn-result').forEach(function(b){b.classList.remove('selected');});
  checkReady();
  autosaveMatchLocal();
}

// ===== LOG =====
function renderLog(){
  var list=document.getElementById('log-list');
  var total=shots.length+otrasContribs.length;
  document.getElementById('log-count').textContent=total;
  if(!total){list.innerHTML='<div style="font-size:12px;color:var(--gray);padding:8px">No hay eventos registrados.</div>';return;}
  list.innerHTML='';
  var allEvents=[];
  shots.forEach(function(s){allEvents.push({type:'shot',data:s,id:s.id});});
  otrasContribs.forEach(function(o){allEvents.push({type:'otra',data:o,id:o.id});});
  allEvents.sort(function(a,b){return b.id-a.id;});
  allEvents.forEach(function(ev){
    if(ev.type==='otra'){
      var o=ev.data;
      var def=OFENSIVA_DEFS.find(function(d){return d.key===o.key;})||{icon:'⚡',label:o.key};
      var item=document.createElement('div'); item.className='log-item otra';
      item.innerHTML='<span class="log-time">'+o.time+'</span>'
        +'<span class="log-info">'+def.icon+' <strong style="color:var(--white)">'+def.label.toUpperCase()+'</strong>'
        +' · <span style="color:var(--gray)">'+escHtml(o.porteroName)+'</span></span>'
        +'<button class="log-edit" onclick="editOtra('+o.id+')" title="Editar">✎</button>'
        +'<button class="log-delete" onclick="deleteOtra('+o.id+')">✕</button>';
      list.appendChild(item); return;
    }
    var s=ev.data;
    var item=document.createElement('div'); item.className='log-item '+s.result;
    var ic={gol:'⚽',parada:'🧤',fuera:'↗'};
    var resultLabel=s.result==='sinportero'?'SIN PORTERO':s.result.toUpperCase();
    // xGOT solo tiene sentido si el tiro fue a puerta de verdad (no 'fuera', no portería
    // vacía) — ver comentario equivalente en el popup de la línea de evolución.
    var xgS=calcularXG(s), xgotS=(s.result!=='fuera'&&!s.noGk)?calcularXGOT(s.goalPos,s.zone):null;
    var xgLabel=(xgS!==null||xgotS!==null)
      ?' · <span style="color:var(--gray)" title="xG: valor esperado de la ocasión · xGOT: valor esperado según la zona de portería">'
        +(xgS!==null?'xG '+xgS:'')+(xgS!==null&&xgotS!==null?' / ':'')+(xgotS!==null?'xGOT '+xgotS:'')+'</span>'
      :'';
    item.innerHTML='<span class="log-time">'+s.time+'</span>'+
      '<span class="log-info">'+(ic[s.result]||'⚽')+' <strong style="color:var(--white)">'+resultLabel+'</strong>'+
      ' · '+escHtml(s.porteroName)+' · <em>'+escHtml(s.zone)+'</em> · <em>'+escHtml(s.goalPos)+'</em>'+
      (s.attacker!=='—'?' · <span style="color:var(--gray)">Nº '+escHtml(s.attacker)+'</span>':'')+
      xgLabel+
      '</span><button class="log-edit" onclick="editShot('+s.id+')" title="Editar">✎</button>'+
      '<button class="log-delete" onclick="deleteShot('+s.id+')">✕</button>';
    list.appendChild(item);
  });
}
function countOtras(key,pid){ return otrasContribs.filter(function(e){return e.key===key&&(pid==null||e.porteroId===pid);}).length; }
function countOtrasByName(key,pname){ return otrasContribs.filter(function(e){return e.key===key&&(pname==null||e.porteroName===pname);}).length; }
function renderOfensiva(){
  var g=document.getElementById('ofensiva-grid'); if(!g) return;
  g.innerHTML='';
  OFENSIVA_DEFS.forEach(function(def){
    var n=countOtras(def.key,receivingPid());
    var card=document.createElement('div'); card.className='ocard'+(n>0?' tapped':'');
    card.onclick=(function(k){return function(e){
      if(e.target.classList.contains('ocard-minus')) return;
      var rid=receivingPid();
      var p=porteros.find(function(x){return x.id===rid;});
      otrasContribs.push({id:Date.now(),time:fmtTime(timerSeconds),videoSeconds:_syncRealSeconds()||0,key:k,
        porteroId:rid,porteroName:p?p.name:'—'});
      renderOfensiva(); renderStats();
      autosaveMatchLocal();
    };})(def.key);
    var icon=document.createElement('div'); icon.style.cssText='font-size:22px;line-height:1'; icon.textContent=def.icon;
    var cnt=document.createElement('div'); cnt.className='ocard-count'; cnt.id='of-'+def.key; cnt.textContent=n;
    var lbl=document.createElement('div'); lbl.className='ocard-label'; lbl.textContent=def.label;
    var bm=document.createElement('button'); bm.className='ocard-minus'; bm.textContent='×'; bm.title='Eliminar último';
    bm.onclick=(function(k){return function(e){
      e.stopPropagation();
      // Remove the LAST event of this key for the active portero
      for(var i=otrasContribs.length-1;i>=0;i--){
        if(otrasContribs[i].key===k&&otrasContribs[i].porteroId===receivingPid()){otrasContribs.splice(i,1);break;}
      }
      renderOfensiva(); renderStats();
      autosaveMatchLocal();
    };})(def.key);
    card.appendChild(bm);
    card.appendChild(icon); card.appendChild(cnt); card.appendChild(lbl);
    g.appendChild(card);
  });
}
function deleteOtra(id){
  otrasContribs=otrasContribs.filter(function(o){return o.id!==id;});
  renderLog(); renderOfensiva(); renderStats();
  autosaveMatchLocal();
}
function deleteShot(id){
  if(!confirm('¿Eliminar este lanzamiento?')) return;
  shots=shots.filter(function(s){return s.id!==id;});
  recomputeScoreThem();
  renderLog(); renderStats(); renderPorteros(); renderFilterBars();
  autosaveMatchLocal();
}
// Recuenta los goles rivales a partir de los lanzamientos, igual que al cargar un partido,
// para que el marcador quede correcto tras editar o borrar un registro.
function recomputeScoreThem(){
  if(dosEquipos){
    // Gol contra el portero del Equipo 1 = gol del Equipo 2 (score-them), y al revés (score-us)
    scoreUs=0; scoreThem=0;
    shots.forEach(function(s){ if(s.result==='gol'){ if(shotGkTeam(s)===1) scoreThem++; else scoreUs++; } });
    var elu=document.getElementById('score-us'); if(elu) elu.textContent=scoreUs;
  } else {
    scoreThem=0;
    shots.forEach(function(s){ if(s.result==='gol') scoreThem++; });
  }
  var el=document.getElementById('score-them');
  if(el) el.textContent=scoreThem;
}

// ===== EDITAR EVENTO REGISTRADO =====
var EDIT_ZONES=['Extremo izq','Extremo der','6m izq','6m cent','6m der','Lateral izq','Central','Lateral der','7 metros','Contraataque'];
var EDIT_GOALPOS=['Alto izq','Alto centro','Alto der','Medio izq','Centro','Medio der','Bajo izq','Bajo centro','Bajo der','Fuera alto izq','Fuera medio izq','Fuera bajo izq','Fuera alto der','Fuera medio der','Fuera bajo der','Fuera arriba izq','Fuera arriba centro','Fuera arriba der'];
function _editOptions(list, current){
  return list.map(function(v){ return '<option value="'+escHtml(v)+'"'+(v===current?' selected':'')+'>'+escHtml(v)+'</option>'; }).join('');
}
function _editModalOpen(){
  var overlay=document.getElementById('edit-event-overlay');
  if(!overlay){
    overlay=document.createElement('div');
    overlay.id='edit-event-overlay';
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML='';
  var box=document.createElement('div');
  box.id='edit-event-box';
  box.style.cssText='background:var(--navy2);border:1px solid var(--border);border-radius:14px;padding:20px;max-width:420px;width:100%;max-height:88vh;overflow-y:auto';
  overlay.appendChild(box);
  return {overlay:overlay, box:box};
}
function editShot(id){
  var s=shots.find(function(x){return x.id===id;});
  if(!s) return;
  var m=_editModalOpen();
  var title=document.createElement('div');
  title.style.cssText='font-family:Bebas Neue,sans-serif;font-size:20px;color:var(--gold);margin-bottom:14px';
  title.textContent='✎ Editar lanzamiento · '+s.time;
  m.box.appendChild(title);

  var isSinPortero=(s.noGk===true);
  var porteroOptions='<option value="none"'+(isSinPortero?' selected':'')+'>Sin portero</option>'+
    porteros.map(function(p){ return '<option value="'+p.id+'"'+((!isSinPortero&&p.id===s.porteroId)?' selected':'')+'>'+escHtml(p.name)+'</option>'; }).join('');
  var attackerOptions='<option value=""'+(!s.attackerId?' selected':'')+'>— sin atacante —</option>'+
    attackers.map(function(a){ return '<option value="'+a.id+'"'+(a.id===s.attackerId?' selected':'')+'>'+escHtml(a.dorsal+' '+a.name)+'</option>'; }).join('');

  m.box.insertAdjacentHTML('beforeend',
    '<div class="edit-field-wrap"><div class="edit-field-label">Portero</div><select id="ed-portero" class="edit-field-select">'+porteroOptions+'</select></div>'+
    '<div class="edit-field-wrap"><div class="edit-field-label">Atacante</div><select id="ed-attacker" class="edit-field-select">'+attackerOptions+'</select></div>'+
    '<div class="edit-field-wrap"><div class="edit-field-label">Zona</div><select id="ed-zone" class="edit-field-select">'+_editOptions(EDIT_ZONES,s.zone)+'</select></div>'+
    '<div class="edit-field-wrap"><div class="edit-field-label">Localización del chut</div><select id="ed-goalpos" class="edit-field-select">'+_editOptions(EDIT_GOALPOS,s.goalPos)+'</select></div>'+
    '<div class="edit-field-wrap"><div class="edit-field-label">Resultado</div><select id="ed-result" class="edit-field-select">'+
      '<option value="gol"'+(s.result==='gol'?' selected':'')+'>⚽ Gol</option>'+
      '<option value="parada" id="ed-result-parada-opt"'+(s.result==='parada'?' selected':'')+(isSinPortero?' disabled':'')+'>🧤 Parada</option>'+
      '<option value="fuera"'+(s.result==='fuera'?' selected':'')+'>↗ Fuera</option>'+
    '</select></div>'+
    '<div class="edit-field-wrap"><div class="edit-field-label">Colaboración defensiva</div><select id="ed-traj" class="edit-field-select">'+
      '<option value=""'+(!s.traj?' selected':'')+'>— ninguna —</option>'+
      '<option value="paralelo"'+(s.traj==='paralelo'?' selected':'')+'>Paralelo</option>'+
      '<option value="cruzado"'+(s.traj==='cruzado'?' selected':'')+'>Cruzado</option>'+
    '</select></div>'+
    '<div class="edit-field-wrap"><div class="edit-field-label">Punto fuerte / débil del atacante</div><select id="ed-pfpd" class="edit-field-select">'+
      '<option value=""'+(!s.pf&&!s.pd?' selected':'')+'>— ninguno —</option>'+
      '<option value="pf"'+(s.pf?' selected':'')+'>Punto fuerte</option>'+
      '<option value="pd"'+(s.pd?' selected':'')+'>Punto débil</option>'+
    '</select></div>'+
    '<div class="edit-field-wrap"><label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);cursor:pointer">'+
      '<input type="checkbox" id="ed-hab"'+(s.hab?' checked':'')+' style="width:16px;height:16px"> Lanzamiento con habilidad'+
    '</label></div>'
  );

  var portSel=document.getElementById('ed-portero');
  var resultSel=document.getElementById('ed-result');
  portSel.addEventListener('change', function(){
    var sinPortero=(portSel.value==='none');
    var paradaOpt=document.getElementById('ed-result-parada-opt');
    paradaOpt.disabled=sinPortero;
    if(sinPortero && resultSel.value==='parada') resultSel.value='fuera';
  });

  var btnRow=document.createElement('div');
  btnRow.style.cssText='display:flex;gap:10px;margin-top:16px';
  var cancelBtn=document.createElement('button');
  cancelBtn.className='btn btn-reset'; cancelBtn.textContent='Cancelar';
  cancelBtn.onclick=function(){ m.overlay.remove(); };
  var saveBtn=document.createElement('button');
  saveBtn.className='btn btn-start'; saveBtn.style.flex='1'; saveBtn.textContent='✓ Guardar cambios';
  saveBtn.onclick=function(){ _saveEditedShot(id, m.overlay); };
  btnRow.appendChild(cancelBtn); btnRow.appendChild(saveBtn);
  m.box.appendChild(btnRow);
}
function _saveEditedShot(id, overlay){
  var s=shots.find(function(x){return x.id===id;});
  if(!s) return;
  var portVal=document.getElementById('ed-portero').value;
  var sinPortero=(portVal==='none');
  var p=sinPortero?null:porteros.find(function(x){return x.id===Number(portVal);});
  var attVal=document.getElementById('ed-attacker').value;
  var a=attVal?attackers.find(function(x){return x.id===Number(attVal);}):null;
  var pfpd=document.getElementById('ed-pfpd').value;

  s.noGk=sinPortero?true:undefined;
  s.porteroId=sinPortero?null:(p?p.id:null);
  s.porteroName=sinPortero?'Sin portero':(p?p.name:'—');
  s.attackerId=a?a.id:null;
  s.attacker=a?(a.dorsal+' '+a.name):'—';
  s.zone=document.getElementById('ed-zone').value;
  s.goalPos=document.getElementById('ed-goalpos').value;
  s.result=document.getElementById('ed-result').value;
  s.traj=document.getElementById('ed-traj').value||undefined;
  s.pf=pfpd==='pf'?true:undefined;
  s.pd=pfpd==='pd'?true:undefined;
  s.hab=document.getElementById('ed-hab').checked?true:undefined;

  overlay.remove();
  recomputeScoreThem();
  renderLog(); renderStats(); renderPorteros(); renderFilterBars();
  if(currentMatchId) saveMatch();
  notify('✅ Lanzamiento actualizado');
}
function editOtra(id){
  var o=otrasContribs.find(function(x){return x.id===id;});
  if(!o) return;
  var m=_editModalOpen();
  var title=document.createElement('div');
  title.style.cssText='font-family:Bebas Neue,sans-serif;font-size:20px;color:var(--gold);margin-bottom:14px';
  title.textContent='✎ Editar contribución · '+o.time;
  m.box.appendChild(title);

  var porteroOptions=porteros.map(function(p){ return '<option value="'+p.id+'"'+(p.id===o.porteroId?' selected':'')+'>'+escHtml(p.name)+'</option>'; }).join('');
  var keyOptions=OFENSIVA_DEFS.map(function(def){ return '<option value="'+def.key+'"'+(def.key===o.key?' selected':'')+'>'+def.icon+' '+escHtml(def.label)+'</option>'; }).join('');

  m.box.insertAdjacentHTML('beforeend',
    '<div class="edit-field-wrap"><div class="edit-field-label">Portero</div><select id="ed-otra-portero" class="edit-field-select">'+porteroOptions+'</select></div>'+
    '<div class="edit-field-wrap"><div class="edit-field-label">Tipo de contribución</div><select id="ed-otra-key" class="edit-field-select">'+keyOptions+'</select></div>'
  );

  var btnRow=document.createElement('div');
  btnRow.style.cssText='display:flex;gap:10px;margin-top:16px';
  var cancelBtn=document.createElement('button');
  cancelBtn.className='btn btn-reset'; cancelBtn.textContent='Cancelar';
  cancelBtn.onclick=function(){ m.overlay.remove(); };
  var saveBtn=document.createElement('button');
  saveBtn.className='btn btn-start'; saveBtn.style.flex='1'; saveBtn.textContent='✓ Guardar cambios';
  saveBtn.onclick=function(){
    var pid=Number(document.getElementById('ed-otra-portero').value);
    var p=porteros.find(function(x){return x.id===pid;});
    o.porteroId=pid; o.porteroName=p?p.name:o.porteroName;
    o.key=document.getElementById('ed-otra-key').value;
    m.overlay.remove();
    renderLog(); renderOfensiva(); renderStats();
    if(currentMatchId) saveMatch();
    notify('✅ Contribución actualizada');
  };
  btnRow.appendChild(cancelBtn); btnRow.appendChild(saveBtn);
  m.box.appendChild(btnRow);
}
function clearAllEvents(){
  if(!shots.length && !otrasContribs.length){ notify('No hay registros que borrar', true); return; }
  if(!confirm('¿Estás seguro que quieres borrar todos los eventos de este partido?')) return;
  shots=[]; otrasContribs=[];
  renderLog(); renderStats(); renderPorteros(); renderFilterBars(); renderOfensiva();
  notify('🗑 Todos los registros eliminados');
}

// ===== FILTER BARS =====
function toggleTraj(type,btn){
  if(selectedTraj===type){selectedTraj=null;}else{selectedTraj=type;}
  var bx=document.getElementById('btn-traj-x');
  var bl=document.getElementById('btn-traj-l');
  if(bx)bx.style.background=selectedTraj==='cruzado'?'rgba(239,68,68,.25)':'transparent';
  if(bl)bl.style.background=selectedTraj==='paralelo'?'rgba(34,197,94,.25)':'transparent';
}
function renderFilterBars(){
  var pb=document.getElementById('portero-filter-bar');
  pb.innerHTML='';
  var pb0=document.createElement('button'); pb0.className='fpill pp'+(filterPortero==='all'?' active':'');
  pb0.textContent='Todos'; pb0.onclick=function(){setPorteroFilter('all',pb0);}; pb.appendChild(pb0);
  porteros.forEach(function(p){
    var b=document.createElement('button'); b.className='fpill pp'+(filterPortero===p.name?' active':'');
    b.textContent=p.name; b.onclick=function(){setPorteroFilter(p.name,b);}; pb.appendChild(b);
  });
  var hb=document.getElementById('half-filter-bar');
  if(hb){
    hb.innerHTML='';
    [['all','Todo el partido'],[1,'1ª parte'],[2,'2ª parte']].forEach(function(o){
      var b=document.createElement('button'); b.className='fpill'+(filterHalf===o[0]?' active':'');
      b.textContent=o[1]; b.onclick=function(){setHalfFilter(o[0],b);}; hb.appendChild(b);
    });
  }
  var jb=document.getElementById('player-filter-bar');
  jb.innerHTML='';
  var jb0=document.createElement('button'); jb0.className='fpill'+(filterPlayer==='all'?' active':'');
  jb0.textContent='Todos'; jb0.onclick=function(){setPlayerFilter('all',jb0);}; jb.appendChild(jb0);
  attackers.forEach(function(a){
    var b=document.createElement('button'); b.className='fpill'+(filterPlayer===a.id?' active':'');
    b.textContent=a.dorsal+' '+a.name; b.onclick=function(){setPlayerFilter(a.id,b);}; jb.appendChild(b);
  });
}
// Parte del partido de un lanzamiento (2026-09-21): el reloj del partido es continuo, la 2ª
// parte empieza en 30:01 (misma convención que las marcas de XPS, ver INICIO 2A PARTE).
function shotHalf(s){ return timeToSec(s.time)<=1800 ? 1 : 2; }
function setHalfFilter(hf,btn){
  filterHalf=hf;
  document.querySelectorAll('#half-filter-bar .fpill').forEach(function(b){b.classList.remove('active');});
  if(btn) btn.classList.add('active');
  renderStats(); updateFilterDetail();
}
function setPorteroFilter(pid,btn){
  statsZoneFilter=null; statsTrajFilter=null; statsGoalPosFilter=null;
  filterPortero=pid; document.querySelectorAll('.fpill.pp').forEach(function(b){b.classList.remove('active');});
  if(btn) btn.classList.add('active');
  else {
    // Called from photo click: find and activate the matching pill
    document.querySelectorAll('.fpill.pp').forEach(function(b){
      if(b.textContent===pid) b.classList.add('active');
    });
  }
  renderStats(); updateFilterDetail();
}
function setPlayerFilter(pid,btn){
  filterPlayer=pid; document.querySelectorAll('#player-filter-bar .fpill').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active'); renderStats(); updateFilterDetail();
}
function updateFilterDetail(){
  var fd=document.getElementById('filter-detail');
  if(fd) fd.innerHTML='';
  var btn=document.getElementById('player-report-btn');
  if(!btn) return;
  var a=filterPlayer!=='all'?attackers.find(function(x){return x.id===filterPlayer;}):null;
  btn.style.display=a?'inline-block':'none';
  if(a) btn.title='Abre el historial completo de '+a.dorsal+' '+a.name+' contra este rival (todas las temporadas) y tus observaciones sobre él/ella';
}

// ===== STATS =====
function getFilteredShots(){
  var fs=shots;
  if(filterPortero!=='all') fs=fs.filter(function(s){return s.porteroName===filterPortero;});
  if(filterPlayer!=='all')  fs=fs.filter(function(s){return s.attackerId===filterPlayer;});
  if(filterHalf!=='all')    fs=fs.filter(function(s){return shotHalf(s)===filterHalf;});
  if(statsTrajFilter)       fs=fs.filter(function(s){return s.traj===statsTrajFilter;});
  if(statsGoalPosFilter)    fs=fs.filter(function(s){return s.goalPos===statsGoalPosFilter;});
  if(statsHabFilter)        fs=fs.filter(function(s){return s.hab;});
  return fs;
}
function toggleRadar(type){
  radarShow[type]=!radarShow[type];
  var btn=document.getElementById('tog-'+type);
  if(btn){
    var onClass={'gol':'on-gol','parada':'on-parada','pct':'on-pct'};
    btn.className='radar-toggle'+(radarShow[type]?' '+onClass[type]:'');
  }
  drawRadar(getFilteredShots());
}

function drawRadar(fs){
  var canvas=document.getElementById('radar-canvas'); if(!canvas) return;
  var ctx=canvas.getContext('2d');
  var W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);

  // Field SVG viewBox 420x370, but we crop bottom (y up to ~310 instead of 370)
  // Canvas 600x530. Reserve 24px bottom for legend.
  var LEG=6, PAD=6;
  var CROP_Y=315; // show only top 315 of 370 SVG units (cuts below 7m/CTQ area)
  var scaleX=(W-PAD*2)/420;
  var scaleY=(H-PAD*2-LEG)/CROP_Y;
  function sx(x){return PAD+x*scaleX;}
  function sy(y){return PAD+y*scaleY;}

  // ── Field background ──────────────────────────────────────────────────────
  ctx.save();
  ctx.fillStyle='#5b9bd5';
  ctx.fillRect(0,0,W,H-LEG);

  // Field border
  ctx.strokeStyle='rgba(255,255,255,.85)'; ctx.lineWidth=2.5;
  ctx.strokeRect(sx(5),sy(5),sx(415)-sx(5),sy(CROP_Y-5)-sy(0));

  // 6m arc
  ctx.beginPath();
  ctx.moveTo(sx(69),sy(5));
  ctx.bezierCurveTo(sx(69),sy(97),sx(351),sy(97),sx(351),sy(5));
  ctx.closePath();
  ctx.fillStyle='#1a4a8a'; ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,.92)'; ctx.lineWidth=2.5; ctx.stroke();

  // 9m dashed arc
  ctx.beginPath();
  ctx.moveTo(sx(5),sy(5));
  ctx.bezierCurveTo(sx(5),sy(158),sx(415),sy(158),sx(415),sy(5));
  ctx.setLineDash([10*scaleX,6*scaleX]);
  ctx.strokeStyle='rgba(255,255,255,.7)'; ctx.lineWidth=2; ctx.stroke();
  ctx.setLineDash([]);

  // 7m spot + line
  ctx.beginPath(); ctx.arc(sx(210),sy(118),4,0,2*Math.PI);
  ctx.fillStyle='rgba(255,255,255,.85)'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(sx(196),sy(118)); ctx.lineTo(sx(224),sy(118));
  ctx.strokeStyle='rgba(255,255,255,.5)'; ctx.lineWidth=1.5; ctx.stroke();

  // Goal net (diagonal grid, clipped)
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx(163),sy(0),sx(257)-sx(163),sy(22)-sy(0));
  ctx.clip();
  ctx.strokeStyle='rgba(255,255,255,.22)'; ctx.lineWidth=0.7;
  for(var gx=150;gx<=270;gx+=10){
    ctx.beginPath();ctx.moveTo(sx(gx),sy(0));ctx.lineTo(sx(gx+14),sy(22));ctx.stroke();
    ctx.beginPath();ctx.moveTo(sx(gx),sy(0));ctx.lineTo(sx(gx-14),sy(22));ctx.stroke();
  }
  ctx.restore();

  // Goal crossbar — red/white stripes (NO dark shadow underneath)
  var barX=sx(159), barW=sx(261)-sx(159), barH=Math.max(7,sy(8)-sy(0));
  for(var si=0;si<10;si++){
    ctx.fillStyle=si%2===0?'#dc2626':'#f0f0f0';
    ctx.fillRect(barX+si/10*barW, sy(0), barW/10+0.5, barH);
  }

  // Goal posts — vertical red/white stripes
  var postW=Math.max(7,sx(164)-sx(156));
  var postH=sy(24)-sy(0);
  for(var pi=0;pi<5;pi++){
    ctx.fillStyle=pi%2===0?'#dc2626':'#f0f0f0';
    // Left post
    ctx.fillRect(sx(156), sy(0)+pi/5*postH, postW, postH/5+0.5);
    // Right post
    ctx.fillRect(sx(256), sy(0)+pi/5*postH, postW, postH/5+0.5);
  }

  ctx.restore();

  // ── Zone centers ──────────────────────────────────────────────────────────
  // EI/ED pushed further into corners (x=5 instead of 5+65/2)
  var ZONE_CENTERS = {
    'Extremo izq':  [sx(5  +18),   sy(22)],
    'Extremo der':  [sx(420-23),   sy(22)],
    '6m izq':       [sx(69 +38),   sy(80)],
    '6m cent':      [sx(147+63),   sy(80)],
    '6m der':       [sx(275+38),   sy(80)],
    'Lateral izq':  [sx(5  +54),   sy(140)],
    'Central':      [sx(143+67),   sy(140)],
    'Lateral der':  [sx(307+54),   sy(140)],
    // 2026-09-24 (petición del usuario): 7m/Contraataque bajan más (sy 218→240) para separarse
    // mejor del resto y dejar sitio a su etiqueta — las únicas dos zonas que la conservan
    // (ver más abajo), porque el resto ya se identifican solas por su posición en el campo.
    '7 metros':     [sx(70 +64),   sy(240)],
    'Contraataque': [sx(221+64),   sy(240)]
  };
  var ZONE_LABELS = {
    'Extremo izq':'EI','Extremo der':'ED',
    '6m izq':'6mI','6m cent':'6mC','6m der':'6mD',
    'Lateral izq':'LI','Central':'CE','Lateral der':'LD',
    '7 metros':'7M','Contraataque':'CTQ'
  };

  // ── Stats ─────────────────────────────────────────────────────────────────
  var zones=Object.keys(ZONE_CENTERS);
  var totalLanz=0;
  var zStats={};
  zones.forEach(function(z){
    var sz=fs.filter(function(s){return s.zone===z;});
    var gol =sz.filter(function(s){return s.result==='gol'||s.result==='sinportero';}).length;
    var par =sz.filter(function(s){return s.result==='parada';}).length;
    var fu  =sz.filter(function(s){return s.result==='fuera';}).length;
    var lanz=sz.filter(function(s){return s.result!=='fuera'&&!s.noGk;}).length;
    // A 7 metros, un lanzamiento fuera también cuenta como éxito de la portera
    var is7m=z==='7 metros', pctDen=is7m?sz.length:lanz, pctNum=is7m?(par+fu):par;
    // Balance (GSAx) de esta zona de campo en concreto — misma fórmula que ya usa la
    // tabla "Por zona de campo" (balanceCell), aplicada aquí a una zona individual.
    var bal=calcularGSAx(sz, null).gsax;
    zStats[z]={gol:gol,par:par,lanz:lanz,pct:pctDen>0?pctNum/pctDen:0,pctOk:pctDen>0,
      pctNum:pctNum,pctDen:pctDen,balance:bal};
    totalLanz+=lanz;
  });
  // ── Circles ───────────────────────────────────────────────────────────────
  var RMAX=Math.min(W,H-LEG)*0.165;
  var RMIN=6;

  zones.forEach(function(z){
    var s=zStats[z]; if(s.lanz===0) return;
    var cx=ZONE_CENTERS[z][0], cy=ZONE_CENTERS[z][1];

    // Tamaño independiente por tipo, escala fija 1-10 (no depende de totalLanz)
    var rGol = s.gol>0 ? RMIN+(Math.min(s.gol,10)/10)*(RMAX-RMIN) : 0;
    var rPar = s.par>0 ? RMIN+(Math.min(s.par,10)/10)*(RMAX-RMIN) : 0;
    var rPct = RMIN+s.pct*(RMAX-RMIN);

    // Orden variable: la esfera más grande al fondo, la más pequeña encima
    var circles=[
      {r:rPct, color:'#3b82f6', fill:'rgba(59,130,246,.55)', key:'pct',    val:s.pct, label:s.pctOk?Math.round(s.pct*100)+'%':null},
      {r:rGol, color:'#ef4444', fill:'rgba(239,68,68,.6)',   key:'gol',    val:s.gol, label:s.gol>0?''+s.gol:null},
      {r:rPar, color:'#22c55e', fill:'rgba(34,197,94,.6)',   key:'parada', val:s.par, label:s.par>0?''+s.par:null}
    ].filter(function(c){return radarShow[c.key]&&c.r>=RMIN&&(c.key==='pct'?s.pctOk:c.val>0);})
     .sort(function(a,b){return b.r-a.r;});

    circles.forEach(function(c){
      ctx.save();
      ctx.beginPath(); ctx.arc(cx,cy,c.r,0,2*Math.PI);
      ctx.fillStyle=c.fill; ctx.fill();
      ctx.strokeStyle=c.color; ctx.lineWidth=2; ctx.stroke();
      ctx.restore();
    });

    // Bloque de texto SIEMPRE igual (%, debajo paradas/lanzamientos —restando esos dos
    // salen los goles—, y debajo el balance GSAx de esta zona de campo), sea cual sea el
    // estado de los filtros gol/parada/pct. Los filtros de arriba solo deciden el
    // tamaño/visibilidad de las esferas; nunca qué número se ve, ni de qué tamaño se ve
    // (petición expresa del usuario, 2026-09-17).
    if(s.pctOk){
      // Tamaño de letra FIJO (2026-09-17, petición expresa): antes se basaba en rPct y
      // variaba de zona a zona según el %, lo que hacía ilegibles los números en zonas con
      // poca muestra. Ahora es constante siempre — solo las esferas de detrás cambian de
      // tamaño, nunca el texto.
      var lf1=24, lf2=15, lf3=15;
      var lh1=lf1*1.05, lh2=lf2*1.15, lh3=lf3*1.15;
      var lTop=cy-(lh1+lh2+lh3)/2;
      var yPct=lTop+lh1/2, yFrac=lTop+lh1+lh2/2, yBal=lTop+lh1+lh2+lh3/2;
      var pctTxt=Math.round(s.pct*100)+'%';

      ctx.save();
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.shadowColor='rgba(0,0,0,.85)'; ctx.shadowBlur=4;

      ctx.font='bold '+lf1+'px DM Sans,sans-serif';
      ctx.fillStyle='#ffffff';
      ctx.fillText(pctTxt,cx,yPct);
      if(z==='7 metros'){
        var lw2=ctx.measureText(pctTxt).width;
        ctx.font='bold '+Math.round(lf1*0.65)+'px DM Sans,sans-serif';
        ctx.fillStyle='#94a3b8'; ctx.textAlign='left';
        ctx.fillText('*',cx+lw2/2+1,yPct-lf1*0.28);
        ctx.textAlign='center';
      }

      ctx.font='700 '+lf2+'px DM Sans,sans-serif';
      ctx.fillStyle='rgba(255,255,255,.88)';
      ctx.fillText(s.pctNum+'/'+s.pctDen,cx,yFrac);

      ctx.font='700 '+lf3+'px DM Sans,sans-serif';
      ctx.fillStyle=(s.balance===null)?'rgba(255,255,255,.55)':(s.balance>=0?'#4ade80':'#f87171');
      ctx.fillText(s.balance===null?'—':(s.balance>0?'+':'')+s.balance,cx,yBal);

      ctx.restore();
    }

    // 2026-09-24 (petición del usuario, 4ª iteración): se quita la etiqueta de TODAS las
    // zonas salvo "7 metros" y "Contraataque" — el resto ya se distingue solo por dónde cae
    // la esfera en el dibujo del campo (extremos, 6m, 9m...), así que el rótulo sobraba.
    // 7m/Contraataque sí lo necesitan (no tienen una posición geométrica real en el campo,
    // son categorías especiales) y bajaron de posición (ver ZONE_CENTERS) para tener hueco.
    if(z==='7 metros'||z==='Contraataque'){
      ctx.save();
      ctx.font='bold 14px DM Sans,sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      var lbl=ZONE_LABELS[z];
      var ly=cy+RMAX-9;
      var tw=ctx.measureText(lbl).width, bw=tw+12, bh=20, bx=cx-bw/2, by=ly-bh/2, br=5;
      ctx.beginPath();
      ctx.moveTo(bx+br,by);
      ctx.lineTo(bx+bw-br,by); ctx.arcTo(bx+bw,by,bx+bw,by+br,br);
      ctx.lineTo(bx+bw,by+bh-br); ctx.arcTo(bx+bw,by+bh,bx+bw-br,by+bh,br);
      ctx.lineTo(bx+br,by+bh); ctx.arcTo(bx,by+bh,bx,by+bh-br,br);
      ctx.lineTo(bx,by+br); ctx.arcTo(bx,by,bx+br,by,br);
      ctx.closePath();
      ctx.fillStyle='rgba(30,34,42,.72)';
      ctx.fill();
      ctx.fillStyle='#ffffff';
      ctx.fillText(lbl,cx,ly);
      ctx.restore();
    }
  });

  // Store zone centers in CSS pixel space for accurate click detection
  // canvas.width is the HTML attribute (physical canvas pixels)
  // CSS display size = canvas.offsetWidth (CSS pixels)
  // ratio = canvas.width / canvas.offsetWidth
  // SVG overlay: same coordinate space as canvas (W x H = 600x530)
  // SVG scales to fit via width/height 100% — no offsetWidth needed
  var overlay = document.getElementById('radar-zone-overlay');
  if(overlay){
    overlay.style.pointerEvents = 'auto';
    var svgLines = [];
    svgLines.push('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 '+W+' '+H+'">');
    zones.forEach(function(z){
      var s=zStats[z]; if(s.lanz===0) return;
      var cx=ZONE_CENTERS[z][0], cy=ZONE_CENTERS[z][1];
      var rMax=totalLanz>0?Math.min(RMAX,RMIN+(Math.max(s.gol,s.par)/totalLanz)*(RMAX-RMIN)*3.5):RMIN;
      var r=Math.max(rMax,RMIN+4)+12;
      var isSelected=statsZoneFilter===z;
      var fill=isSelected?'rgba(255,255,255,.15)':'transparent';
      var stroke=isSelected?'white':'transparent';
      var dash=isSelected?'stroke-dasharray="8 5"':'';
      svgLines.push('<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="'+fill+'" stroke="'+stroke+'" stroke-width="3" '+dash+' data-z="'+z+'" style="cursor:pointer"/>');
    });
    svgLines.push('</svg>');
    overlay.innerHTML = svgLines.join('');
    overlay.querySelectorAll('circle').forEach(function(el){
      el.addEventListener('click', function(){
        setStatsZoneFilter(el.getAttribute('data-z'), null);
      });
      el.addEventListener('mouseenter', function(){ el.setAttribute('fill','rgba(255,255,255,.18)'); });
      el.addEventListener('mouseleave', function(){
        el.setAttribute('fill', statsZoneFilter===el.getAttribute('data-z') ? 'rgba(255,255,255,.15)' : 'transparent');
      });
    });
  }

  // Highlight selected zone with ring if filtered
  if(statsZoneFilter && ZONE_CENTERS[statsZoneFilter]){
    var sc=ZONE_CENTERS[statsZoneFilter]; // already in physical px — draw directly
    ctx.save();
    ctx.beginPath(); ctx.arc(sc[0],sc[1],RMAX*0.85+12,0,2*Math.PI);
    ctx.strokeStyle='rgba(255,255,255,.9)'; ctx.lineWidth=3;
    ctx.setLineDash([6,4]); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
  }

}

function renderStats(){
  var fs=getFilteredShots();
  var par=fs.filter(function(s){return s.result==='parada';}).length;
  var gol=fs.filter(function(s){return s.result==='gol'||s.result==='sinportero';}).length;
  var fue=fs.filter(function(s){return s.result==='fuera';}).length;
  // Excluir "sinportero" del denominador y del cómputo de goles para el %
  // (no hay portera que parar, no debe penalizar la estadística)
  var leConPort=fs.filter(function(s){return s.result!=='fuera'&&s.result!=='sinportero'&&!s.noGk;}).length;
  var golConPort=fs.filter(function(s){return s.result==='gol';}).length;
  var le=leConPort;
  var pct=le>0?Math.round(par/le*100):null;
  var big=document.getElementById('global-big-pct');
  big.textContent=pct!==null?pct+'%':'—%';
  big.className='big-pct'; big.style.color=pctColor(pct);
  // Show portero photos
  var photoDiv=document.getElementById('portero-photo-display');
  var photoImg=document.getElementById('portero-photo-img');
  var photosDiv=document.getElementById('porteros-photos-display');
  if(filterPortero==='all'){
    // Show all porteros that have shots in this match
    if(photoDiv) photoDiv.style.display='none';
    if(photosDiv){
      // Reutiliza los nodos existentes (por id estable "pstat-<id>") en vez de vaciar y
      // recrear todo cada vez (2026-09-18): renderStats() se llama tras cada acción del
      // partido, y recrear el <img src="data:..."> de cada portero obliga al navegador a
      // volver a decodificar su foto entera cada vez, aunque no haya cambiado — el mismo
      // problema de fondo que ya se arregló para el refresco de cada segundo (ver
      // updateActivePorteroTimeDisplay). Aquí solo se actualiza el % y el color; la foto
      // (el <img>) nunca se toca si el portero sigue siendo el mismo.
      var wantedIds={};
      porteros.forEach(function(p){
        var hasShotsP=shots.some(function(s){return s.porteroName===p.name;});
        if(!hasShotsP||!p.photo) return;
        var sp=shots.filter(function(s){return s.porteroName===p.name&&s.result!=='fuera'&&s.result!=='sinportero'&&!s.noGk;});
        var pp2=sp.length>0?Math.round(sp.filter(function(s){return s.result==='parada';}).length/sp.length*100):null;
        var domId='pstat-'+p.id;
        wantedIds[domId]=true;
        var wrap=document.getElementById(domId);
        if(wrap){
          // Ya existe: solo refresca lo que puede cambiar (%, color), la foto se queda igual.
          var lbl=wrap.querySelector('.pstat-lbl'), img=wrap.querySelector('img');
          if(lbl){ lbl.textContent=pp2!==null?pp2+'%':'—'; lbl.style.color=pctColor(pp2); }
          if(img){
            img.style.borderColor=pctColor(pp2);
            img.style.objectPosition=(p.ox||50)+'% '+(p.oy||20)+'%';
            img.title=p.name+(pp2!==null?' — '+pp2+'%':'')+' · Clic para filtrar';
            if(img.src!==p.photo) img.src=p.photo; // por si la foto sí cambió de verdad
          }
          photosDiv.appendChild(wrap); // reordena sin recrear
          return;
        }
        // No existe todavía: se crea una única vez.
        wrap=document.createElement('div');
        wrap.id=domId;
        wrap.style.cssText='display:inline-flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;flex-shrink:0';
        wrap.onclick=(function(pname){ return function(){
          if(filterPortero===pname){setPorteroFilter('all',null);}else{setPorteroFilter(pname,null);}
        }; })(p.name);
        var lbl=document.createElement('div');
        lbl.className='pstat-lbl';
        lbl.style.cssText='font-size:11px;font-weight:700;color:'+pctColor(pp2)+';font-family:DM Sans,sans-serif';
        lbl.textContent=pp2!==null?pp2+'%':'—';
        var img=document.createElement('img');
        img.src=p.photo;
        img.style.cssText='width:56px;height:56px;border-radius:50%;object-fit:cover;object-position:'+(p.ox||50)+'% '+(p.oy||20)+'%;border:3px solid '+pctColor(pp2)+';transition:transform .15s';
        img.title=p.name+(pp2!==null?' — '+pp2+'%':'')+' · Clic para filtrar';
        wrap.onmouseenter=function(){img.style.transform='scale(1.1)';};
        wrap.onmouseleave=function(){img.style.transform='';};
        wrap.appendChild(lbl);
        wrap.appendChild(img);
        photosDiv.appendChild(wrap);
      });
      // Quita los que ya no correspondan (portero sin foto/sin tiros ya, o cambio de filtro)
      Array.prototype.slice.call(photosDiv.children).forEach(function(el){
        if(!wantedIds[el.id]) el.remove();
      });
    }
  } else {
    // Single portero filtered
    if(photosDiv) photosDiv.innerHTML='';
    var activeP=porteros.find(function(p){return p.name===filterPortero;});
    if(photoDiv&&photoImg){
      if(activeP&&activeP.photo){
        if(photoImg.src!==activeP.photo) photoImg.src=activeP.photo; // evita redecodificar si no ha cambiado
        photoImg.style.objectPosition=(activeP.ox||50)+'% '+(activeP.oy||20)+'%';
        photoDiv.style.borderColor=pctColor(pct);
        photoDiv.style.display='block';
        setTimeout(function(){
          var c2=document.getElementById('portero-photo-display');
          if(c2&&c2._dragAttached&&c2._setPortero) c2._setPortero(activeP);
          else attachStatsDrag(activeP);
        },10);
      } else {
        photoImg.src=''; photoDiv.style.display='none';
      }
    }
  }
  document.getElementById('g-total').textContent=fs.length;
  document.getElementById('g-paradas').textContent=par;
  document.getElementById('g-goles').textContent=gol;
  document.getElementById('g-fuera').textContent=fue;
  var xgInfo=xgTotalEquipo(fs);
  var gxEl=document.getElementById('g-xg');
  if(gxEl) gxEl.textContent = xgInfo.conDato ? xgInfo.xg + (xgInfo.conDato<xgInfo.total?' ('+xgInfo.conDato+'/'+xgInfo.total+' con zona)':'') : '—';
  var gsaxInfo=calcularGSAx(fs, null);
  var gsEl=document.getElementById('g-gsax');
  if(gsEl){
    gsEl.textContent = gsaxInfo.gsax!==null ? (gsaxInfo.gsax>0?'+':'')+gsaxInfo.gsax : '—';
    gsEl.style.color = gsaxInfo.gsax===null ? '' : gsaxInfo.gsax>=0 ? 'var(--green)' : 'var(--red)';
  }
  var bigG=document.getElementById('global-big-gsax');
  if(bigG){
    bigG.textContent = gsaxInfo.gsax!==null ? (gsaxInfo.gsax>0?'+':'')+gsaxInfo.gsax : '—';
    bigG.style.color = gsaxInfo.gsax===null ? 'var(--gray)' : gsaxInfo.gsax>=0 ? 'var(--green)' : 'var(--red)';
  }
  var xgotEl=document.getElementById('g-xgot');
  if(xgotEl) xgotEl.textContent = gsaxInfo.tirosConDato ? gsaxInfo.xGOTRecibido : '—';
  var zones=['Lateral izq','Central','Lateral der','6m izq','6m cent','6m der','Extremo izq','Extremo der','Contraataque','7 metros'];
  var tbody=document.getElementById('zone-table-body'); tbody.innerHTML=''; var any=false;
  // Balance = GSAx: paradas esperadas (según la zona de portería de cada tiro) frente a
  // las paradas reales. GSAx = solo la mitad "esperada" de esa cuenta, sin restarle nada.
  function balanceCell(sh){
    var g=calcularGSAx(sh, null);
    if(g.gsax===null) return '<td style="color:var(--gray)">—</td>';
    var esperadas=Math.round((g.tirosConDato-g.xGOTRecibido)*100)/100;
    return '<td style="color:'+(g.gsax>=0?'var(--green)':'var(--red)')+';font-weight:600" title="Paradas esperadas: '+esperadas+' · Paradas reales: '+g.paradas+'">'+(g.gsax>0?'+':'')+g.gsax+'</td>';
  }
  // xGOT (2026-09-25): antes esta columna mostraba "paradas esperadas" (lo complementario,
  // n-xGOTRecibido) bajo el nombre GSAx — ahora muestra directamente la suma de xGOT (goles
  // esperados) de ese grupo de tiros, que es el mismo dato al revés sobre el mismo total.
  function gsaxCell(sh){
    var g=calcularGSAx(sh, null);
    if(!g.tirosConDato) return '<td style="color:var(--gray)">—</td>';
    return '<td style="color:var(--text)" title="Sobre '+g.tirosConDato+' tiros a puerta con zona de portería registrada">'+g.xGOTRecibido+'</td>';
  }
  function addGroupRow(label,groupZones,color){
    var sg=fs.filter(function(s){return groupZones.indexOf(s.zone)>=0;});
    if(!sg.length) return;
    var pr=sg.filter(function(s){return s.result==='parada';}).length;
    var gl=sg.filter(function(s){return s.result==='gol'||s.result==='sinportero';}).length;
    var fu=sg.filter(function(s){return s.result==='fuera';}).length;
    var lz=sg.filter(function(s){return s.result!=='fuera'&&s.result!=='sinportero'&&!s.noGk;}).length;
    var pp=lz>0?Math.round(pr/lz*100):null;
    var c=pctColor(pp);
    var tr=document.createElement('tr');
    tr.style.cssText='border-top:2px solid rgba(255,255,255,.15);background:rgba(255,255,255,.03)';
    tr.style.cursor='pointer';
    tr.onclick=function(){setStatsZoneFilter(label,this);};
    tr.innerHTML='<td style="color:'+color+';font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px">'+label+'</td><td>'+sg.length+'</td><td class="tag-parada">'+pr+'</td><td class="tag-gol">'+gl+'</td><td class="tag-fuera">'+fu+'</td><td style="color:'+c+';font-weight:700">'+(pp!==null?pp+'%':'—')+'</td>'+gsaxCell(sg)+balanceCell(sg);
    tbody.appendChild(tr); any=true;
    // Sub-rows
    groupZones.forEach(function(z){
      var sz=fs.filter(function(s){return s.zone===z;}); if(!sz.length) return;
      var pr2=sz.filter(function(s){return s.result==='parada';}).length;
      var gl2=sz.filter(function(s){return s.result==='gol'||s.result==='sinportero';}).length;
      var fu2=sz.filter(function(s){return s.result==='fuera';}).length;
      var lz2=sz.filter(function(s){return s.result!=='fuera'&&s.result!=='sinportero'&&!s.noGk;}).length;
      var pp2=lz2>0?Math.round(pr2/lz2*100):null;
      var c2=pctColor(pp2);
      var subTr=document.createElement('tr');subTr.style.cursor='pointer';subTr.onclick=(function(zz){return function(){setStatsZoneFilter(zz,this);};})(z);subTr.innerHTML='<td style="padding-left:18px;color:#94a3b8;font-size:12px">'+z+'</td><td>'+sz.length+'</td><td class="tag-parada">'+pr2+'</td><td class="tag-gol">'+gl2+'</td><td class="tag-fuera">'+fu2+'</td><td style="color:'+c2+';font-weight:600">'+(pp2!==null?pp2+'%':'—')+'</td>'+gsaxCell(sz)+balanceCell(sz);tbody.appendChild(subTr);
    });
  }
  addGroupRow('9m total',['Lateral izq','Central','Lateral der'],'#93c5fd');
  addGroupRow('6m total',['6m izq','6m cent','6m der'],'#6ee7b7');
  addGroupRow('Extremos',['Extremo izq','Extremo der'],'#fcd34d');
  // Remaining zones not in groups
  ['Contraataque','7 metros'].forEach(function(z){
    var sz=fs.filter(function(s){return s.zone===z;}); if(!sz.length) return; any=true;
    var pr=sz.filter(function(s){return s.result==='parada';}).length;
    var gl=sz.filter(function(s){return s.result==='gol'||s.result==='sinportero';}).length;
    var fu=sz.filter(function(s){return s.result==='fuera';}).length;
    var lz=sz.filter(function(s){return s.result!=='fuera'&&s.result!=='sinportero'&&!s.noGk;}).length;
    // A 7 metros, un lanzamiento fuera también cuenta como "éxito" defensivo: se suma a las paradas
    var pp=z==='7 metros'?(sz.length>0?Math.round((pr+fu)/sz.length*100):null):(lz>0?Math.round(pr/lz*100):null);
    var c=pctColor(pp);
    var remTr=document.createElement('tr');remTr.style.cssText='border-top:2px solid rgba(255,255,255,.15);cursor:pointer';remTr.onclick=(function(zz){return function(){setStatsZoneFilter(zz,this);};})(z);remTr.innerHTML='<td>'+z+'</td><td>'+sz.length+'</td><td class="tag-parada">'+pr+'</td><td class="tag-gol">'+gl+'</td><td class="tag-fuera">'+fu+'</td><td style="color:'+c+';font-weight:700">'+(pp!==null?pp+'%'+(z==='7 metros'?'*':''):'—')+'</td>'+gsaxCell(sz)+balanceCell(sz);tbody.appendChild(remTr);
  });
  // Fila especial: lanzamientos con habilidad — al final
  var habShots=fs.filter(function(s){return s.hab;});
  if(habShots.length>0){
    var hPar=habShots.filter(function(s){return s.result==='parada';}).length;
    var hGol=habShots.filter(function(s){return s.result==='gol'||s.result==='sinportero';}).length;
    var hLanz=habShots.filter(function(s){return s.result!=='fuera'&&s.result!=='sinportero'&&!s.noGk;}).length;
    var hFuera=habShots.filter(function(s){return s.result==='fuera';}).length;
    var hPct=hLanz>0?Math.round(hPar/hLanz*100):null;
    var hTr=document.createElement('tr');
    hTr.innerHTML='<td style="color:#d8b4fe;font-weight:600">✨ Con habilidad</td><td>'+habShots.length+'</td><td>'+hLanz+'</td><td style="color:#22c55e">'+hPar+'</td><td style="color:#ef4444">'+hGol+'</td><td style="color:#64748b">'+hFuera+'</td><td style="color:#f59e0b">'+(hPct!==null?hPct+'%':'--')+'</td>'+gsaxCell(habShots)+balanceCell(habShots);
    hTr.style.borderTop='2px solid rgba(168,85,247,.3)';
    hTr.style.borderBottom='2px solid rgba(168,85,247,.3)';
    hTr.style.cursor='pointer';
    hTr.dataset.hab='1';
    if(statsHabFilter){ hTr.style.background='rgba(168,85,247,.18)'; hTr.style.outline='1px solid rgba(168,85,247,.5)'; }
    hTr.onclick=function(){ setStatsHabFilter(); };
    tbody.appendChild(hTr);
    any=true;
  }
  if(!any){
    var noneMsg=(filterPlayer!=='all'||filterPortero!=='all'||filterHalf!=='all')?'Sin lanzamientos registrados con este filtro.':'Sin lanzamientos registrados en este partido.';
    tbody.innerHTML='<tr><td colspan="8" style="color:var(--gray);padding:12px;text-align:center">'+noneMsg+'</td></tr>';
  }
  // Draw goal heatmap — use filtered by zone and/or habilidad if active
  var goalShots=statsZoneFilter?(function(){
    var gm={'9m total':['Lateral izq','Central','Lateral der'],'6m total':['6m izq','6m cent','6m der'],'Extremos':['Extremo izq','Extremo der']};
    var gz=gm[statsZoneFilter]||[statsZoneFilter];
    return fs.filter(function(s){return gz.indexOf(s.zone)>=0;});
  })():fs;
  drawGoalHeatmap(goalShots);
  var _rf=(function(){var gm={'9m total':['Lateral izq','Central','Lateral der'],'6m total':['6m izq','6m cent','6m der'],'Extremos':['Extremo izq','Extremo der']};if(!statsZoneFilter)return fs;var gz=gm[statsZoneFilter]||[statsZoneFilter];return fs.filter(function(s){return gz.indexOf(s.zone)>=0;});})();  try{drawRadar(_rf);}catch(e){}
  try{
    var mtd=document.getElementById('match-title-display');
    if(mtd){
      var titleEl=document.getElementById('main-title');
      var rivalEl=document.getElementById('rival-name');
      if(titleEl&&titleEl.textContent) mtd.textContent=titleEl.textContent.trim()||'—';
      var mrd=document.getElementById('match-rival-display');
      var mdd=document.getElementById('match-date-display');
      var rv=rivalEl&&rivalEl.value!=null?rivalEl.value.trim():'';
      if(mrd) mrd.textContent=rv?'vs '+rv:'';
      if(mdd&&currentMatchId){
        var fsD=loadFS(); var mf=fsD.files.find(function(f){return f.id===currentMatchId;});
        if(mf){ mdd.textContent=new Date(mf.date).toLocaleDateString('es-ES');
          if(mf.parentId&&mrd){var folder=fsD.folders.find(function(f){return f.id===mf.parentId;});
            if(folder) mrd.textContent=(rv?rv+' · ':'')+folder.name;}
        }
      }
    }
  }catch(e){}
  // Ofensiva mini panel
  var mini=document.getElementById('ofensiva-mini');
  var miniList=document.getElementById('ofensiva-mini-list');
  if(mini&&miniList){
    miniList.innerHTML='';
    var anyPositive=false;
    var miniPname = filterPortero!=='all' ? filterPortero : null;
    var miniPid = filterPortero!=='all' ? (porteros.find(function(p){return p.name===filterPortero;})||{}).id : null;
    OFENSIVA_DEFS.forEach(function(def){
      var v = miniPname ? countOtrasByName(def.key, miniPname) : countOtras(def.key, null);
      if(v<=0) return;
      anyPositive=true;
      var row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:7px;background:var(--navy3)';
      row.innerHTML='<span style="font-size:16px">'+def.icon+'</span>'
        +'<span style="flex:1;color:var(--gray);font-size:11px">'+def.label+'</span>'
        +'<span style="font-family:Bebas Neue,sans-serif;font-size:20px;color:var(--white)">'+v+'</span>';
      miniList.appendChild(row);
    });
    mini.style.display=anyPositive?'block':'none';
    // Goles sin portera
    var spEl=document.getElementById('sinportero-mini');
    var spCount=shots.filter(function(s){return s.result==='sinportero'||(s.noGk&&s.result==='gol');}).length;
    if(!spEl){
      spEl=document.createElement('div');
      spEl.id='sinportero-mini';
      spEl.style.cssText='margin-top:8px;padding:6px 10px;border-radius:7px;background:var(--navy3);display:flex;align-items:center;gap:8px';
      mini.appendChild(spEl);
    }
    if(spCount>0){
      spEl.innerHTML='<span style="font-size:16px">⚽</span>'
        +'<span style="flex:1;color:var(--gray);font-size:11px">Goles sin portera</span>'
        +'<span style="font-family:Bebas Neue,sans-serif;font-size:20px;color:rgba(156,163,175,.8)">'+spCount+'</span>';
      spEl.style.display='flex';
      mini.style.display='block';
    } else {
      spEl.style.display='none';
    }
  }
  try{ drawTimeline(fs); }catch(e){}
}
// ===== TABS =====
function showSection(id,btn){
  document.querySelectorAll('.section').forEach(function(s){s.classList.remove('active');});
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  var sec=document.getElementById('sec-'+id);
  sec.classList.add('active'); btn.classList.add('active');
  sec.scrollTop=0;
  if(id==='estadisticas'){renderFilterBars();renderStats();updateFilterDetail();}
  updateActiveGkBubble();
}

// ===== IMPORTAR DESDE XPS (Sideline Sports Video Analyzer) =====
// Vocabulario XPS -> vocabulario HK Stats, confirmado sobre exports reales del usuario.
var XPS_ZONE_MAP = {
  '7m':'7 metros','ctq':'Contraataque',
  '6m izq':'6m izq','6m cent':'6m cent','6m der':'6m der',
  '9m izq':'Lateral izq','9m cent':'Central','9m der':'Lateral der',
  'ext izq':'Extremo izq','ext der':'Extremo der'
};
var XPS_GOALPOS_MAP = {
  'alto izq':'Alto izq','alto cent':'Alto centro','alto centro':'Alto centro','alto der':'Alto der',
  'medio izq':'Medio izq','medio cent':'Centro','medio der':'Medio der',
  'abajo izq':'Bajo izq','abajo cent':'Bajo centro','abajo centro':'Bajo centro','abajo der':'Bajo der'
};
var XPS_RESULT_MAP = {'gol':'gol','parada':'parada','fuera':'fuera'};
var XPS_TRAJ_MAP = {'recto':'paralelo','cruzado':'cruzado'};
var XPS_OTRAS_MAP = {'chut a porteria fallado':'gpgFallo'};
var XPS_KIND_OPTIONS = {
  zone:[['','(sin zona)'],['6m izq','6m izq'],['6m cent','6m cent'],['6m der','6m der'],['Lateral izq','Lateral izq'],['Central','Central'],['Lateral der','Lateral der'],['Extremo izq','Extremo izq'],['Extremo der','Extremo der'],['7 metros','7 metros'],['Contraataque','Contraataque']],
  goalpos:[['','(sin posición)'],['Alto izq','Alto izq'],['Alto centro','Alto centro'],['Alto der','Alto der'],['Medio izq','Medio izq'],['Centro','Centro'],['Medio der','Medio der'],['Bajo izq','Bajo izq'],['Bajo centro','Bajo centro'],['Bajo der','Bajo der'],['Fuera alto izq','Fuera alto izq'],['Fuera medio izq','Fuera medio izq'],['Fuera bajo izq','Fuera bajo izq'],['Fuera alto der','Fuera alto der'],['Fuera medio der','Fuera medio der'],['Fuera bajo der','Fuera bajo der'],['Fuera arriba izq','Fuera arriba izq'],['Fuera arriba centro','Fuera arriba centro'],['Fuera arriba der','Fuera arriba der']],
  result:[['','(descartar este lanzamiento)'],['gol','Gol'],['parada','Parada'],['fuera','Fuera']],
  traj:[['','(sin colaboración defensiva)'],['cruzado','Cruzado'],['paralelo','Paralelo']],
  otras:[['','(descartar)']].concat(OFENSIVA_DEFS.map(function(d){return [d.key,d.label];}))
};

function _xpsNorm(raw){
  return String(raw||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[\[\]]/g,'').replace(/\//g,' ').replace(/\s+/g,' ').trim();
}
function _xpsHeaderKey(h){
  return String(h||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
}
function _xpsUserMap(){
  try{ return JSON.parse(localStorage.getItem('hb_xps_map')||'{}'); }catch(e){ return {}; }
}
function _xpsSaveUserMap(map){
  try{ localStorage.setItem('hb_xps_map', JSON.stringify(map)); }catch(e){}
}
// Resuelve un valor crudo de XPS a su equivalente en HK Stats, mirando primero las
// correcciones que el usuario ya haya guardado y luego el diccionario por defecto.
function _xpsResolve(kind, raw){
  var key = _xpsNorm(raw);
  if(!key) return {value:null, known:true, empty:true};
  var defaults = {zone:XPS_ZONE_MAP, goalpos:XPS_GOALPOS_MAP, result:XPS_RESULT_MAP, traj:XPS_TRAJ_MAP, otras:XPS_OTRAS_MAP}[kind];
  var userMap = _xpsUserMap();
  var userKey = kind+':'+key;
  if(Object.prototype.hasOwnProperty.call(userMap,userKey)) return {value:userMap[userKey]||null, known:true};
  if(Object.prototype.hasOwnProperty.call(defaults,key)) return {value:defaults[key], known:true};
  return {value:null, known:false};
}

// Export de XPS Video Analyzer: texto separado por tabuladores, UTF-8, fin de línea CRLF.
function _xpsParseTSV(text){
  var lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  lines = lines.filter(function(l){ return l.trim().length>0; });
  if(!lines.length) return [];
  var header = lines[0].split('\t').map(_xpsHeaderKey);
  return lines.slice(1).map(function(line){
    var cols = line.split('\t');
    var obj = {};
    header.forEach(function(h,i){ obj[h] = (cols[i]||'').trim(); });
    return obj;
  });
}
function _xpsTimeToSec(hms){
  var m = String(hms||'').trim().match(/^(\d+):(\d{2}):(\d{2})$/);
  if(!m) return null;
  return (+m[1])*3600 + (+m[2])*60 + (+m[3]);
}
// Empareja "16 Marcos Garcia" con la portera de ESTE partido por dorsal (preferente) o nombre.
function _xpsResolvePortero(rawPortero){
  var s = String(rawPortero||'').trim();
  if(!s) return {ok:false, id:null, name:null};
  var m = s.match(/^(\S+)\s+(.+)$/);
  var dorsal = m ? m[1] : null;
  var name = m ? m[2] : s;
  if(dorsal){
    var byDorsal = porteros.find(function(p){ return p.dorsal && String(p.dorsal).trim()===dorsal; });
    if(byDorsal) return {ok:true, id:byDorsal.id, name:byDorsal.name};
  }
  var byName = porteros.find(function(p){ return p.name && p.name.trim().toLowerCase()===name.trim().toLowerCase(); });
  if(byName) return {ok:true, id:byName.id, name:byName.name};
  return {ok:false, id:null, name:s};
}
function _xpsFindAttacker(rawAttacker){
  var s = String(rawAttacker||'').trim();
  if(!s || s.toUpperCase()==='NINGUNO') return null;
  return attackers.find(function(a){ return (a.dorsal+' '+a.name).trim().toLowerCase()===s.toLowerCase(); }) || null;
}
// Analiza cada fila del CSV/TSV exportado y decide si se puede importar tal cual,
// sin escribir nada todavía — es lo que alimenta la previsualización.
function _xpsAnalyzeRows(rows){
  return rows.map(function(row, idx){
    var deportista = row['deportista']||'';
    var otrasRaw = row['otras contribuciones']||'';
    var isOtras = deportista.toUpperCase()==='NINGUNO' && otrasRaw.trim().length>0;
    var startSec = _xpsTimeToSec(row['start']);
    var problems = [];

    if(isOtras){
      var oInfo = _xpsResolve('otras', otrasRaw);
      var pInfo = _xpsResolvePortero(row['portero']);
      if(!oInfo.known) problems.push('categoría "'+otrasRaw+'" desconocida');
      if(!pInfo.ok) problems.push('portero "'+row['portero']+'" no identificado');
      if(startSec===null) problems.push('tiempo de inicio ilegible');
      return {idx:idx, type:'otras', raw:row, startSec:startSec,
        key:oInfo.value, keyRaw:otrasRaw, porteroId:pInfo.id, porteroName:pInfo.name,
        ok: problems.length===0, problems: problems};
    }

    var noGk = (row['sin portero']||'').trim().toLowerCase()==='true';
    var resInfo = _xpsResolve('result', row['resultado']);
    var zoneInfo = _xpsResolve('zone', row['zona del campo']);
    var gpInfo = _xpsResolve('goalpos', row['localizacion chut']);
    var trajInfo = _xpsResolve('traj', row['estimulo']);
    var hab = (row['habilidad']||'').trim().toLowerCase()==='true';
    var pInfo2 = noGk ? {ok:true, id:null, name:'Sin portero'} : _xpsResolvePortero(row['portero']);
    var attExisting = _xpsFindAttacker(deportista);

    if(!row['resultado']) problems.push('sin resultado');
    else if(!resInfo.known) problems.push('resultado "'+row['resultado']+'" desconocido');
    if(row['zona del campo'] && !zoneInfo.known) problems.push('zona "'+row['zona del campo']+'" desconocida');
    if(row['localizacion chut'] && !gpInfo.known) problems.push('posición de portería "'+row['localizacion chut']+'" desconocida');
    if(row['estimulo'] && !trajInfo.known) problems.push('colaboración defensiva "'+row['estimulo']+'" desconocida');
    if(!noGk && !pInfo2.ok) problems.push('portero "'+row['portero']+'" no identificado');
    if(startSec===null) problems.push('tiempo de inicio ilegible');

    return {idx:idx, type:'shot', raw:row, startSec:startSec,
      zone:zoneInfo.value, goalPos:gpInfo.value, result:resInfo.value,
      hab:hab, traj:trajInfo.value, noGk:noGk,
      porteroId:pInfo2.id, porteroName:pInfo2.name,
      attackerId: attExisting?attExisting.id:null,
      attackerLabel: deportista, attackerIsNew: !!(deportista && deportista.toUpperCase()!=='NINGUNO' && !attExisting),
      ok: problems.length===0, problems: problems};
  });
}
function _xpsCollectUnknowns(analysis){
  var seen = {};
  analysis.forEach(function(r){
    function check(kind, rawVal){
      if(!rawVal) return;
      var info = _xpsResolve(kind, rawVal);
      if(info.known) return;
      var k = kind+'|'+_xpsNorm(rawVal);
      if(!seen[k]) seen[k] = {kind:kind, raw:rawVal, count:0};
      seen[k].count++;
    }
    if(r.type==='otras'){ check('otras', r.keyRaw); }
    else {
      check('result', r.raw['resultado']);
      check('zone', r.raw['zona del campo']);
      check('goalpos', r.raw['localizacion chut']);
      check('traj', r.raw['estimulo']);
    }
  });
  return Object.keys(seen).map(function(k){return seen[k];});
}
function openXpsImport(){
  var inp = document.getElementById('xpsFileInput'); if(inp) inp.click();
}
var _xpsPendingAnalysis = null;
function onXpsFileSelected(ev){
  var f = ev.target.files[0]; ev.target.value='';
  if(!f) return;
  var reader = new FileReader();
  reader.onload = function(){
    try{
      var rows = _xpsParseTSV(String(reader.result));
      if(!rows.length){ notify('El archivo no tiene filas de datos', true); return; }
      _xpsPendingAnalysis = _xpsAnalyzeRows(rows);
      _xpsOpenPreview();
    }catch(e){ notify('No se ha podido leer el archivo: '+e.message, true); }
  };
  reader.readAsText(f, 'UTF-8');
}
function _xpsOpenPreview(){
  var analysis = _xpsPendingAnalysis;
  var overlay = document.getElementById('xps-overlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'xps-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML='';
  var box = document.createElement('div');
  box.style.cssText='background:var(--navy2);border:1px solid var(--border);border-radius:14px;padding:20px;max-width:560px;width:100%;max-height:88vh;overflow-y:auto';
  overlay.appendChild(box);

  var title = document.createElement('div');
  title.style.cssText='font-family:Bebas Neue,sans-serif;font-size:20px;color:var(--gold);margin-bottom:10px';
  title.textContent='🎥 Importar desde XPS';
  box.appendChild(title);

  var unknowns = _xpsCollectUnknowns(analysis);
  if(unknowns.length){
    var warn = document.createElement('div');
    warn.style.cssText='font-size:12px;color:#fca5a5;margin-bottom:10px';
    warn.textContent='Hay '+unknowns.length+' valor(es) del archivo que no reconozco. Asígnalos para poder importar esas filas (se recordará para la próxima vez):';
    box.appendChild(warn);
    unknowns.forEach(function(u){
      var row = document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12px';
      var lbl = document.createElement('span'); lbl.style.cssText='flex:1;color:var(--text)';
      lbl.textContent = '"'+u.raw+'" ('+u.count+'×, '+u.kind+')';
      var sel = document.createElement('select');
      sel.style.cssText='background:var(--navy3);color:var(--white);border:1px solid var(--border);border-radius:6px;padding:4px 6px;font-size:12px';
      (XPS_KIND_OPTIONS[u.kind]||[]).forEach(function(opt){
        var o = document.createElement('option'); o.value=opt[0]; o.textContent=opt[1];
        sel.appendChild(o);
      });
      sel.onchange = function(){
        var userMap = _xpsUserMap();
        userMap[u.kind+':'+_xpsNorm(u.raw)] = sel.value || null;
        _xpsSaveUserMap(userMap);
        _xpsPendingAnalysis = _xpsAnalyzeRows(_xpsPendingAnalysis.map(function(r){return r.raw;}));
        _xpsOpenPreview();
      };
      row.appendChild(lbl); row.appendChild(sel);
      box.appendChild(row);
    });
  }

  var okShots = analysis.filter(function(r){return r.type==='shot'&&r.ok;}).length;
  var okOtras = analysis.filter(function(r){return r.type==='otras'&&r.ok;}).length;
  var bad = analysis.filter(function(r){return !r.ok;});
  var newAttackers = {};
  analysis.forEach(function(r){ if(r.type==='shot'&&r.attackerIsNew) newAttackers[r.attackerLabel]=true; });

  var summary = document.createElement('div');
  summary.style.cssText='font-size:13px;color:var(--text);margin:12px 0;line-height:1.7';
  summary.innerHTML =
    '✅ <b>'+okShots+'</b> lanzamiento'+(okShots!==1?'s':'')+' listo'+(okShots!==1?'s':'')+' para importar<br>'+
    (okOtras?'✅ <b>'+okOtras+'</b> otra(s) contribución(es) lista(s)<br>':'') +
    (bad.length?'⚠️ <b>'+bad.length+'</b> fila'+(bad.length!==1?'s':'')+' NO se importarán (sin resolver)<br>':'') +
    (Object.keys(newAttackers).length?'👤 Se crearán <b>'+Object.keys(newAttackers).length+'</b> atacante(s) nuevo(s) en el partido<br>':'');
  box.appendChild(summary);

  if(bad.length){
    var badList = document.createElement('div');
    badList.style.cssText='font-size:11px;color:var(--gray);max-height:100px;overflow-y:auto;margin-bottom:10px;border-top:1px solid var(--border);padding-top:6px';
    badList.innerHTML = bad.slice(0,20).map(function(r){
      return escHtml((r.raw['start']||'?')+' — '+r.problems.join(', '));
    }).join('<br>') + (bad.length>20?'<br>… y '+(bad.length-20)+' más':'');
    box.appendChild(badList);
  }

  var calWrap = document.createElement('div');
  calWrap.style.cssText='margin:14px 0;padding-top:10px;border-top:1px solid var(--border)';
  calWrap.innerHTML =
    '<div style="font-size:12px;color:var(--gray);margin-bottom:6px">Calibración opcional — tiempo de vídeo (HH:MM:SS) en el que empieza cada parte, para que el tiempo importado coincida con el reloj del marcador. Si lo dejas en blanco, se usará el tiempo de vídeo tal cual.</div>'+
    '<div style="display:flex;gap:8px">'+
      '<input id="xps-cal-h1" placeholder="Inicio 1ª parte" style="flex:1;background:var(--navy3);border:1px solid var(--border);border-radius:6px;color:var(--white);padding:6px 8px;font-size:12px">'+
      '<input id="xps-cal-h2" placeholder="Inicio 2ª parte" style="flex:1;background:var(--navy3);border:1px solid var(--border);border-radius:6px;color:var(--white);padding:6px 8px;font-size:12px">'+
    '</div>';
  box.appendChild(calWrap);

  var btnRow = document.createElement('div');
  btnRow.style.cssText='display:flex;gap:10px;margin-top:14px';
  var cancelBtn = document.createElement('button');
  cancelBtn.className='btn btn-reset'; cancelBtn.textContent='Cancelar';
  cancelBtn.onclick = function(){ overlay.remove(); _xpsPendingAnalysis=null; };
  var okBtn = document.createElement('button');
  okBtn.className='btn btn-start'; okBtn.style.flex='1';
  okBtn.textContent = '✓ Importar '+(okShots+okOtras)+' evento'+(okShots+okOtras!==1?'s':'');
  okBtn.disabled = (okShots+okOtras)===0;
  okBtn.onclick = function(){ _xpsConfirmImport(overlay); };
  btnRow.appendChild(cancelBtn); btnRow.appendChild(okBtn);
  box.appendChild(btnRow);
}
function _xpsConfirmImport(overlay){
  if(!_xpsPendingAnalysis){ overlay.remove(); return; }
  var h1 = _xpsTimeToSec(document.getElementById('xps-cal-h1').value);
  var h2 = _xpsTimeToSec(document.getElementById('xps-cal-h2').value);
  if((h1==null) !== (h2==null)){
    notify('⚠️ Solo se ha rellenado uno de los dos tiempos de calibración; los eventos de la 2ª parte pueden salir con el tiempo sin calibrar', true);
  }
  function computeTime(startSec){
    if(startSec==null) return fmtTime(0);
    if(h1==null) return fmtTime(startSec); // sin calibrar: tiempo de vídeo tal cual
    if(h2!=null && startSec>=h2) return fmtTime(1800 + Math.max(0,startSec-h2));
    return fmtTime(Math.max(0,startSec-h1));
  }
  var created = 0, createdOtras = 0;
  var attackerCache = {};
  _xpsPendingAnalysis.forEach(function(r, i){
    if(!r.ok) return;
    if(r.type==='otras'){
      otrasContribs.push({id:Date.now()+i, time:computeTime(r.startSec), key:r.key, porteroId:r.porteroId, porteroName:r.porteroName});
      createdOtras++;
      return;
    }
    var attackerId = r.attackerId;
    if(!attackerId && r.attackerLabel){
      var cacheKey = r.attackerLabel.toLowerCase();
      if(attackerCache[cacheKey]){
        attackerId = attackerCache[cacheKey];
      } else {
        var m = r.attackerLabel.match(/^(\S+)\s+(.+)$/);
        var newA = {id:Date.now()+i+1000000, dorsal:m?m[1]:'?', name:m?m[2]:r.attackerLabel};
        attackers.push(newA);
        attackerId = newA.id;
        attackerCache[cacheKey] = attackerId;
      }
    }
    shots.push({
      id:Date.now()+i+2000000,
      time:computeTime(r.startSec),
      porteroId:r.porteroId, porteroName:r.porteroName,
      attackerId:attackerId||null, attacker:r.attackerLabel||'—',
      zone:r.zone, goalPos:r.goalPos, result:r.result,
      hab:r.hab?true:undefined, traj:r.traj||undefined, noGk:r.noGk?true:undefined
    });
    if(r.result==='gol') scoreThem = scoreThem+1;
    created++;
  });
  var scoreThemEl = document.getElementById('score-them'); if(scoreThemEl) scoreThemEl.textContent = scoreThem;
  overlay.remove();
  _xpsPendingAnalysis = null;
  renderAttackers(); renderLog(); renderStats(); renderFilterBars(); renderPorteros();
  notify('✅ Importados '+created+' lanzamientos'+(createdOtras?' y '+createdOtras+' otras contribuciones':'')+' desde XPS');
  if(currentMatchId) saveMatch();
}

// ===== EXPORTAR A XPS (SportsCode XML / CSV) =====
// Vocabulario HK Stats -> vocabulario XPS, inverso de los diccionarios de importación.
// Zona del Campo es un atributo de tipo Árbol en XPS: las zonas con rama/hoja van como
// [rama]/[hoja] (p.ej. [9m]/[cent]); las que no tienen sub-zona van solo con [hoja].
var XPS_ZONE_EXPORT = {
  '7 metros':'[7m]','Contraataque':'[ctq]',
  '6m izq':'[6m]/[izq]','6m cent':'[6m]/[cent]','6m der':'[6m]/[der]',
  'Lateral izq':'[9m]/[izq]','Central':'[9m]/[cent]','Lateral der':'[9m]/[der]',
  'Extremo izq':'[ext]/[izq]','Extremo der':'[ext]/[der]'
};
var XPS_GOALPOS_EXPORT = {
  'Alto izq':'alto izq','Alto centro':'alto cent','Alto der':'alto der',
  'Medio izq':'medio izq','Centro':'medio cent','Medio der':'medio der',
  'Bajo izq':'abajo izq','Bajo centro':'abajo cent','Bajo der':'abajo der',
  'Fuera alto izq':'fuera alto izq','Fuera medio izq':'fuera medio izq','Fuera bajo izq':'fuera abajo izq',
  'Fuera alto der':'fuera alto der','Fuera medio der':'fuera medio der','Fuera bajo der':'fuera abajo der',
  'Fuera arriba izq':'fuera arriba izq','Fuera arriba centro':'fuera arriba cent','Fuera arriba der':'fuera arriba der'
};
var XPS_RESULT_EXPORT = {'gol':'Gol','parada':'Parada','fuera':'Fuera'};
var XPS_TRAJ_EXPORT = {'paralelo':'Recto','cruzado':'Cruzado'};
var XPS_OTRAS_EXPORT = {'gpgFallo':'Chut a porteria fallado'};

function _xpsDefaultMargins(){
  // Recomendación de soporte de XPS: el clip empieza unos segundos antes de la acción
  // y termina justo en el momento marcado (sin margen extra después).
  return {marginPre:8, marginPost:0};
}
var xpsMargins = _xpsDefaultMargins();

function _xpsFmtHMS(sec){
  sec = Math.max(0, Math.round(sec));
  var hh=Math.floor(sec/3600), mm=Math.floor((sec%3600)/60), ss=sec%60;
  return String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0');
}
// Base = segundo real capturado en vivo (preciso) si existe; si no, el minuto del marcador (estimado).
// XPS tiene su propia herramienta de calibración, así que no aplicamos ningún offset aquí.
function _xpsShotBaseSec(shotOrContrib){
  var matchSec = timeToSec(shotOrContrib.time);
  return (shotOrContrib.videoSeconds!=null && shotOrContrib.videoSeconds>0) ? shotOrContrib.videoSeconds : matchSec;
}
// Estima el segundo real de vídeo correspondiente a un instante del reloj del PARTIDO (marcador),
// anclándose al evento capturado en vivo más cercano en el tiempo (en vez de asumir que el reloj
// del partido y el del vídeo avanzan siempre a la par — no es así, p.ej. por el descanso real).
function _xpsEstimateVideoSec(matchSec){
  var candidates = shots.concat(otrasContribs).filter(function(s){
    return s.videoSeconds!=null && s.videoSeconds>0;
  });
  if(!candidates.length) return matchSec;
  var nearest = null, nearestDiff = Infinity, nearestMatchSec = 0;
  candidates.forEach(function(s){
    var sMatchSec = timeToSec(s.time);
    var diff = Math.abs(sMatchSec-matchSec);
    if(diff<nearestDiff){ nearestDiff=diff; nearest=s; nearestMatchSec=sMatchSec; }
  });
  return nearest.videoSeconds + (matchSec-nearestMatchSec);
}
function _xpsPorteroLabel(porteroId, fallbackName){
  var p = porteros.find(function(x){ return x.id===porteroId; });
  if(!p) return fallbackName || 'Sin portero';
  return (p.dorsal?p.dorsal+' ':'')+p.name;
}
// Construye la lista unificada de eventos (lanzamientos + otras contribuciones) con
// su tiempo de vídeo ya calculado, ordenados cronológicamente.
function _xpsBuildExportEvents(margins){
  var events = [];
  shots.forEach(function(s){
    var videoSec = _xpsShotBaseSec(s);
    events.push({
      kind:'shot',
      start: Math.max(0, videoSec-(margins.marginPre||0)),
      end: videoSec+(margins.marginPost||0),
      result:s.result, zone:s.zone, goalPos:s.goalPos,
      porteroLabel:_xpsPorteroLabel(s.porteroId, s.porteroName),
      attacker:s.attacker, hab:!!s.hab, noGk:!!s.noGk, traj:s.traj||''
    });
  });
  otrasContribs.forEach(function(o){
    var videoSec = _xpsShotBaseSec(o);
    var def = OFENSIVA_DEFS.find(function(d){return d.key===o.key;});
    events.push({
      kind:'otras',
      start: Math.max(0, videoSec-(margins.marginPre||0)),
      end: videoSec+(margins.marginPost||0),
      otrasKey:o.key, otrasLabel: def?def.label:o.key,
      porteroLabel:_xpsPorteroLabel(o.porteroId, o.porteroName)
    });
  });
  // Marcas de referencia recomendadas por soporte de XPS para poder calibrar el vídeo:
  // inicio del partido e inicio de la 2ª parte (30:01 en el reloj del PARTIDO, no del vídeo).
  [{label:'INICIO PARTIDO', matchSec:0}, {label:'INICIO 2A PARTE', matchSec:1801}].forEach(function(mk){
    var videoSec = _xpsEstimateVideoSec(mk.matchSec);
    events.push({
      kind:'marker',
      start: Math.max(0, videoSec-(margins.marginPre||0)),
      end: videoSec,
      label: mk.label
    });
  });
  events.sort(function(a,b){ return a.start-b.start; });
  return events;
}
// Filas compartidas (cabecera + una fila por evento) usadas tanto para el portapapeles (tabulador)
// como para el export a Excel (coma) — así los dos formatos nunca pueden desincronizarse entre sí.
function _xpsBuildRows(margins){
  var rival = ((document.getElementById('rival-name')||{}).value||'Rival').trim()||'Rival';
  var titleEl = document.getElementById('main-title');
  var matchLabel = (titleEl?titleEl.textContent.trim():'')+' vs '+rival;
  var events = _xpsBuildExportEvents(margins);
  var header = ['Partido','Nr','D','Start','End','Equipo','Deportista','Portero','Zona del Campo','Localizacion chut','Habilidad','Sin portero','Estímulo','Resultado','Otras contribuciones'];
  var rows = events.map(function(e,i){
    if(e.kind==='marker'){
      return [matchLabel,(i+1),e.label,_xpsFmtHMS(e.start),_xpsFmtHMS(e.end),rival,'NINGUNO','','','','false','false','','',''];
    } else if(e.kind==='otras'){
      return [matchLabel,(i+1),'',_xpsFmtHMS(e.start),_xpsFmtHMS(e.end),rival,'NINGUNO',e.porteroLabel,'','','false','false','','',(XPS_OTRAS_EXPORT[e.otrasKey]||e.otrasLabel)];
    } else {
      return [matchLabel,(i+1),'',_xpsFmtHMS(e.start),_xpsFmtHMS(e.end),rival,(e.attacker&&e.attacker!=='—')?e.attacker:'NINGUNO',e.noGk?'':e.porteroLabel,
        e.zone?(XPS_ZONE_EXPORT[e.zone]||e.zone):'', e.goalPos?(XPS_GOALPOS_EXPORT[e.goalPos]||e.goalPos):'',
        e.hab?'true':'false', e.noGk?'true':'false', e.traj?(XPS_TRAJ_EXPORT[e.traj]||e.traj):'',
        XPS_RESULT_EXPORT[e.result]||e.result||'', ''];
    }
  });
  return {header:header, rows:rows};
}
// Tabulador: formato que XPS reconoce al pegar directamente en "Generar eventos".
function _xpsBuildCSV(margins){
  var d = _xpsBuildRows(margins);
  var lines = [d.header.join('\t')].concat(d.rows.map(function(row){
    return row.map(function(v){ return String(v==null?'':v); }).join('\t');
  }));
  return lines.join('\r\n');
}
function _csvEscapeExcel(v){
  var s = String(v==null?'':v);
  return /[";\n\r]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
// Punto y coma + BOM UTF-8: en la configuración regional española (y la mayoría de Europa),
// Excel usa ';' como separador de listas en CSV (la coma la reserva para decimales), así que
// abre directamente sin asistente de importación en Excel, Google Sheets y LibreOffice.
function _xpsBuildCSVExcel(margins){
  var d = _xpsBuildRows(margins);
  var lines = [d.header.map(_csvEscapeExcel).join(';')].concat(d.rows.map(function(row){
    return row.map(_csvEscapeExcel).join(';');
  }));
  return String.fromCharCode(0xFEFF)+lines.join('\r\n');
}
function _xpsDownload(filename, content, mime){
  var blob = new Blob([content], {type:mime});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
function openXpsExport(){
  if(!shots.length && !otrasContribs.length){ notify('No hay lanzamientos que exportar', true); return; }
  _xpsOpenExportModal();
}
function _xpsOpenExportModal(){
  var overlay = document.getElementById('xps-export-overlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'xps-export-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML='';
  var box = document.createElement('div');
  box.className='modal';
  box.style.cssText='max-width:520px;width:100%;max-height:88vh';
  overlay.appendChild(box);

  var header = document.createElement('div');
  header.className='modal-header';
  header.innerHTML = '<span class="modal-title">🎥 Exportar a XPS</span>';
  var closeBtn = document.createElement('button');
  closeBtn.className='modal-close'; closeBtn.textContent='✕';
  closeBtn.onclick=function(){ overlay.remove(); };
  header.appendChild(closeBtn);
  box.appendChild(header);

  var body = document.createElement('div');
  body.style.cssText='padding:20px;overflow-y:auto';
  box.appendChild(body);

  var count = shots.length + otrasContribs.length + 2; // +2 por las marcas de inicio de partido / 2ª parte
  var info = document.createElement('div');
  info.style.cssText='font-size:13px;color:var(--text);margin-bottom:14px';
  info.textContent = count+' evento'+(count!==1?'s':'')+' de este partido se exportarán (incluye las marcas de inicio de partido y de 2ª parte).';
  body.appendChild(info);

  var marginWrap = document.createElement('div');
  marginWrap.style.cssText='margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--border)';
  marginWrap.innerHTML =
    '<div style="font-size:12px;color:var(--gray);margin-bottom:6px">Márgenes del corte (segundos antes / después de cada evento)</div>'+
    '<div style="display:flex;gap:8px">'+
      '<input id="xps-margin-pre" type="number" value="'+xpsMargins.marginPre+'" style="width:70px;background:var(--navy3);border:1px solid var(--border);border-radius:6px;color:var(--white);padding:6px 8px;font-size:12px">'+
      '<input id="xps-margin-post" type="number" value="'+xpsMargins.marginPost+'" style="width:70px;background:var(--navy3);border:1px solid var(--border);border-radius:6px;color:var(--white);padding:6px 8px;font-size:12px">'+
    '</div>';
  body.appendChild(marginWrap);

  var excelBtn = document.createElement('button');
  excelBtn.className='btn btn-reset'; excelBtn.style.width='100%'; excelBtn.style.marginBottom='10px';
  excelBtn.textContent='📊 Exportar a Excel';
  excelBtn.title='Descarga un .csv que abre directamente en Excel, Google Sheets o LibreOffice, para revisar los datos en una tabla';
  excelBtn.onclick=function(){ _xpsExportExcel(); };
  body.appendChild(excelBtn);

  var copyBtn = document.createElement('button');
  copyBtn.className='btn btn-start'; copyBtn.style.width='100%';
  copyBtn.textContent='📋 Copiar al portapapeles';
  copyBtn.title='Copia la tabla para pegarla directamente en XPS con Ctrl+V (Generar eventos → pegar desde portapapeles)';
  copyBtn.onclick=function(){ _xpsCopyTable(); };
  body.appendChild(copyBtn);
}
function _xpsCopyToClipboard(text){
  function fallbackCopy(){
    var ta=document.createElement('textarea');
    ta.value=text; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    var ok=false;
    try{ ok=document.execCommand('copy'); }catch(e){}
    document.body.removeChild(ta);
    return ok;
  }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){
      notify('✅ Tabla copiada al portapapeles — pégala en XPS con Ctrl+V');
    }).catch(function(){
      var ok=fallbackCopy();
      notify(ok?'✅ Tabla copiada al portapapeles — pégala en XPS con Ctrl+V':'No se pudo copiar al portapapeles', !ok);
    });
  } else {
    var ok2=fallbackCopy();
    notify(ok2?'✅ Tabla copiada al portapapeles — pégala en XPS con Ctrl+V':'No se pudo copiar al portapapeles', !ok2);
  }
}
function _xpsCopyTable(){
  _xpsReadMarginsFromModal();
  if(currentMatchId) saveMatch();
  _xpsCopyToClipboard(_xpsBuildCSV(xpsMargins));
}
function _xpsReadMarginsFromModal(){
  xpsMargins.marginPre = parseFloat((document.getElementById('xps-margin-pre')||{}).value)||0;
  xpsMargins.marginPost = parseFloat((document.getElementById('xps-margin-post')||{}).value)||0;
}
function _xpsExportExcel(){
  _xpsReadMarginsFromModal();
  var rival = ((document.getElementById('rival-name')||{}).value||'partido').trim()||'partido';
  var dateStr = todayStrSafe();
  if(currentMatchId) saveMatch(); // persiste los márgenes junto al partido
  _xpsDownload('xps_'+rival.replace(/[^a-z0-9]+/gi,'_')+'_'+dateStr+'.csv', _xpsBuildCSVExcel(xpsMargins), 'text/csv;charset=utf-8');
  notify('✅ Exportado a Excel');
}
function todayStrSafe(){
  var d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

// ===== SAVE / LOAD =====
function getMatchData(){
  var logoImg=document.getElementById('logo-img');
  var logoRaw=(logoImg&&logoImg.style.display!=='none'&&logoImg.src&&logoImg.src.startsWith('data:'))?logoImg.src:null;
  var rivalName=(document.getElementById('rival-name').value||'').trim();
  // El escudo del rival se guarda una sola vez por rival (_logoCache), no dentro de cada
  // partido — igual que ya hacen las fotos de portero (ver saveRivalLogo). Si aún no
  // sabemos el nombre del rival (campo vacío en ese instante), se deja embebido tal cual
  // para no perderlo. saveRivalLogo() ya evita repetir la subida si no ha cambiado, así que
  // esto es seguro de llamar en cada autoguardado.
  var logoData=logoRaw;
  if(logoRaw && rivalName){
    saveRivalLogo(rivalName, logoRaw);
    logoData=null;
  }
  // Sync portero names from DOM inputs (in case oninput hasn't fired yet)
  porteros.forEach(function(p){
    var inp=document.querySelector('.portero-name-input[data-pid="'+p.id+'"]');
    if(inp) p.name=inp.value||p.name;
  });
  // Strip photos from match data (stored separately in _photoCache / hb_photos)
  var porterosSafe=porteros.map(function(p){return Object.assign({},p,{photo:null});});
  return{id:currentMatchId||('m_'+Date.now()),title:document.getElementById('main-title').textContent.trim(),
    rival:document.getElementById('rival-name').value,date:currentMatchDate||(new Date().toISOString()),
    logoData:logoData,
    timerSeconds:timerSeconds,realSeconds:_syncRealSeconds(),porteros:porterosSafe,attackers:attackers,shots:shots,ownGoals:ownGoals||[],scoreUs:scoreUs,scoreThem:scoreThem,scoreSwapped:scoreSwapped,otrasContribs:otrasContribs,xpsMargins:xpsMargins,dosEquipos:dosEquipos,teamNames:teamNames};
}
function loadMatchData(data){
  stopTimer();
  currentMatchId=data.id; currentMatchDate=data.date||null; timerSeconds=data.timerSeconds||0; realSeconds=data.realSeconds||0; realStartTs=null;
  xpsMargins=data.xpsMargins||_xpsDefaultMargins();
  porteros=data.porteros||[{id:1,name:'Portero 1',dorsal:'',photo:null,seconds:0,ox:50,oy:20},{id:2,name:'Portero 2',dorsal:'',photo:null,seconds:0,ox:50,oy:20}];
  rehydratePhotos(porteros);
  nextPid=Math.max.apply(null,porteros.map(function(p){return p.id;}))+1;
  attackers=data.attackers||[]; shots=data.shots||[]; ownGoals=data.ownGoals||[];
  scoreUs=data.scoreUs||0;
  // Always recount rival goals from shots so the scoreboard matches the log
  scoreThem=0;
  (data.shots||[]).forEach(function(s){
    if(s.result==='gol'||s.result==='sinportero') scoreThem++;
  });
  document.getElementById('score-us').textContent=scoreUs;
  document.getElementById('score-them').textContent=scoreThem;
  scoreSwapped=data.scoreSwapped||false;
  applyScoreSwap(scoreSwapped);
  // Modo 2 equipos: por defecto en juego el primer portero de cada equipo, recibe el Equipo 1
  dosEquipos=!!data.dosEquipos&&teamPorteros(2).length>0;
  teamNames=(data.teamNames&&data.teamNames.length===2)?data.teamNames.slice():['Equipo 1','Equipo 2'];
  equipoRecibe=1;
  activePorteroId=teamPorteros(1)[0]?teamPorteros(1)[0].id:(porteros[0]?porteros[0].id:null);
  activePorteroId2=dosEquipos?teamPorteros(2)[0].id:null;
  selectedAttacker=null;
  if(dosEquipos) recomputeScoreThem();
  applyDosUI();
  filterPortero='all'; filterPlayer='all'; filterHalf='all';
  // Si había una selección de lanzamiento a medias del partido anterior (p.ej. zona
  // elegida pero sin registrar), no debe colarse en este partido recién abierto.
  selectedZone=null; selectedGoalPos=null; selectedResult=null;
  selectedNoGk=false; selectedHab=false; selectedTraj=null; selectedPfPd=null; selectedDeflected=false; selectedRebote=false;
  document.querySelectorAll('[data-zone]').forEach(function(b){
    var sp=b.dataset.zone==='7 metros'||b.dataset.zone==='Contraataque';
    b.style.background=sp?'rgba(120,70,0,.4)':'rgba(15,40,90,.75)';
    b.style.borderColor=sp?'rgba(245,158,11,.9)':'rgba(255,255,255,.5)';
    b.style.color=sp?'#fbbf24':'#fff'; b.style.boxShadow='none';
  });
  document.querySelectorAll('.gcell').forEach(function(b){b.style.background=b.classList.contains('gcell-fuera')?'rgba(239,68,68,.10)':'rgba(255,255,255,.06)';b.style.boxShadow='none';});
  document.querySelectorAll('.btn-result').forEach(function(b){b.classList.remove('selected');});
  var lz0=document.getElementById('zone-active-lbl'); if(lz0) lz0.textContent='Sin zona seleccionada';
  var gl0=document.getElementById('goal-active-lbl'); if(gl0) gl0.textContent='Sin posición seleccionada';
  checkReady();
  document.getElementById('main-title').textContent=data.title||'REAL FEDERACIÓN ESPAÑOLA DE BALONMANO';
  document.getElementById('rival-name').value=data.rival||'';
  // Restore logo. `data.logoData` solo viene embebido en partidos antiguos (guardados
  // antes del 2026-09-18) o cuando el rival no tenía nombre al guardar; en los nuevos se
  // busca en _logoCache por nombre de rival (ver getMatchData/saveRivalLogo) — si tampoco
  // está en este dispositivo, se intenta bajar de la nube en segundo plano.
  var logoImg=document.getElementById('logo-img');
  var logoPlus=document.getElementById('logo-plus');
  var rivalForLogo=(data.rival||'').trim();
  var resolvedLogo=data.logoData || (rivalForLogo?getRivalLogo(rivalForLogo):null);
  if(resolvedLogo){
    logoImg.src=resolvedLogo; logoImg.style.display='block'; logoPlus.style.display='none';
  } else {
    logoImg.src=''; logoImg.style.display='none'; logoPlus.style.display='block';
  }
  if(!resolvedLogo && rivalForLogo){
    var loadedMatchId=data.id;
    _downloadPhotoIfMissing('rival', rivalForLogo,
      function(){ return !!_logoCache[rivalForLogo]; },
      function(b64){ _logoCache[rivalForLogo]=b64; _idbSet('hb_logos', _logoCache); },
      function(got){
        if(got && currentMatchId===loadedMatchId){
          var li=document.getElementById('logo-img'), lp=document.getElementById('logo-plus');
          li.src=_logoCache[rivalForLogo]; li.style.display='block'; lp.style.display='none';
        }
      }
    );
  }
  // Restore ofensiva counters
  otrasContribs=data.otrasContribs||[];
  renderOfensiva();
  updateTimerDisplay(); updateRealTimerDisplay(); renderPorteros(); renderAttackers(); renderLog(); renderStats(); renderFilterBars();
}
// Crea o actualiza la entrada de fsData.files para este partido (mismo id => conserva
// nombre/carpeta ya asignados; id nuevo => genera nombre y lo mete el primero). La usan
// tanto saveMatch() (guardado normal, con sync a la nube) como autosaveMatchLocal().
function _buildFileEntry(data, fsData){
  var idx=fsData.files.findIndex(function(f){return f.id===data.id;});
  var prevEntry=idx>=0?fsData.files[idx]:null;
  var existingParent=prevEntry?prevEntry.parentId:null;
  var autoName=data.title+' — '+new Date().toLocaleDateString('es-ES');
  // El nombre visible en el directorio se regenera desde el título del partido EN CADA
  // guardado mientras el usuario no lo haya renombrado nunca a mano (autoNamed===true,
  // marcado solo al crear el archivo — ver startRename(), que lo pone a false en cuanto se
  // usa el lápiz ✏️ del explorador). Antes se fijaba una sola vez, en el primer guardado, y
  // ya no se tocaba jamás — si esa primera vez el campo de título aún tenía el texto del
  // partido ANTERIOR (el campo persiste entre partidos a propósito), el nombre quedaba
  // congelado con un texto que no tenía nada que ver, para siempre (bug real, 2026-09-24:
  // un partido con 49 tiros de "VALLADOLID vs TORRELAVEGA" apareciendo en el directorio
  // como "DHP GUADALAJARA vs ZARAUTZ", el título del partido justo anterior). Un archivo sin
  // el campo `autoNamed` (todos los guardados antes de este cambio) se trata como YA
  // renombrado a mano, para no reescribir de golpe el nombre de partidos antiguos que el
  // usuario sí haya personalizado.
  var autoNamed = prevEntry ? (prevEntry.autoNamed===true) : true;
  var entry={id:data.id,
    name:autoNamed?autoName:prevEntry.name,
    autoNamed:autoNamed,
    parentId:existingParent,date:data.date,data:data};
  if(idx>=0){
    // Conserva el estado de papelera (trashedAt/trashId/stateTs/isTrashRoot) del registro
    // anterior: este objeto se reconstruye desde cero en CADA guardado (manual o autosave),
    // así que si no se copian estos campos, cualquier resave de un partido que estuviera en
    // la papelera lo "resucita" en este dispositivo sin pasar por restoreTrashItem() (bug
    // real, 2026-09-24: un partido borrado volvía a aparecer tras un autoguardado posterior
    // al mismo id — ver deleteItem(), que solo limpia currentMatchId al borrar un partido
    // suelto, no al borrar una carpeta que lo contenga).
    var prev=fsData.files[idx];
    if(prev.trashedAt){
      entry.trashedAt=prev.trashedAt; entry.trashId=prev.trashId;
      entry.stateTs=prev.stateTs; entry.isTrashRoot=prev.isTrashRoot;
    }
    fsData.files[idx]=entry;
  } else {
    var minOrder=fsData.files.filter(function(f){return f.parentId===entry.parentId;})
      .reduce(function(m,f){return Math.min(m,f.order||0);},0);
    entry.order=minOrder-1;
    fsData.files.unshift(entry);
  }
  return entry;
}
// Autoguardado silencioso: se llama después de cada evento del partido (tiro, gol propio,
// otra contribución...) para que una recarga inesperada de la app (conexión inestable,
// pestaña recuperada por el sistema, etc.) nunca pierda más que el evento que se estuviera
// registrando en ese instante. A propósito NO sincroniza con la nube ni muestra ningún
// aviso — eso sigue siendo cosa de saveMatch() (botón manual, cierre de la app, cambio de
// pestaña) para no disparar tráfico de red en cada tiro. También sirve para que el partido
// tenga currentMatchId desde el primer momento (se llama nada más crear un partido nuevo),
// en vez de quedarse sin id hasta el primer guardado manual — así los avisos de
// beforeunload/visibilitychange (que dependen de currentMatchId) ya protegen desde el inicio.
function autosaveMatchLocal(){
  var fsData=loadFS(), data=getMatchData();
  currentMatchId=data.id;
  if(!currentMatchDate) currentMatchDate=data.date;
  _buildFileEntry(data, fsData);
  _persistLocalOnly(fsData);
}
function saveMatch(){
  var fsData=loadFS(), data=getMatchData(); currentMatchId=data.id;
  if(!currentMatchDate) currentMatchDate=data.date;
  var entry=_buildFileEntry(data, fsData);
  saveFS(fsData);
  localStorage.setItem('hb_last_title', data.title||'');
  var li=document.getElementById('logo-img');
  if(li&&li.style.display!=='none'&&li.src&&li.src.startsWith('data:'))
    localStorage.setItem('hb_last_logo', li.src);
  else
    localStorage.removeItem('hb_last_logo');
  var porteroTemplate=teamPorteros(1).map(function(p){return{id:p.id,name:p.name,dorsal:p.dorsal||'',photo:null,ox:p.ox,oy:p.oy};});
  try{ localStorage.setItem('hb_last_porteros', JSON.stringify(porteroTemplate)); }catch(e){}
  notify('✅ Partido guardado');
  // Subida incremental automática: solo este partido + estructura (rápido, no todo el histórico)
  syncSingleMatchToCloud(entry);
  _syncPhotos(false); // fotos nuevas o cambiadas de las porteras y del rival de este partido
}

// ===== SYNC INCREMENTAL (un solo partido) =====
function syncSingleMatchToCloud(entry){
  if(!window._fbReady || !window._fbDb) return; // silencioso: sin conexión no bloquea el guardado local
  // La estructura (carpetas + ids de partido) ya la sube saveFS() justo antes, en
  // saveMatch(), vía _fbSync() — que ahora fusiona con la nube en vez de sobrescribirla
  // (ver _fbSync). Repetirla aquí con una copia propia del cálculo era exactamente la
  // carrera de sobrescritura reportada: dos subidas independientes de la misma estructura,
  // cada una calculada solo a partir de lo que este dispositivo conocía en ese instante.
  var ts = Date.now();
  var fileClean = JSON.parse(JSON.stringify(entry));
  if(fileClean.data && fileClean.data.porteros) fileClean.data.porteros.forEach(function(p){ p.photo=null; });
  var serialized = JSON.stringify(fileClean);
  if(serialized.length/1024 >= 900) return;
  window._fbSetDoc(window._fbDoc(window._fbDb,'sync','hb_file_'+entry.id), {data:serialized, ts:ts})
    .then(function(){
      // Marca este partido como "confirmado al día" con este ts, y vuelve a subir la
      // estructura (documento pequeño) para que ese ts llegue también a hb_structure.fileTs
      // — saveFS() ya la había subido justo antes de esta llamada, pero en ese momento
      // este partido aún no tenía el ts nuevo, así que otros dispositivos seguirían viendo
      // el ts antiguo (o ninguno) y no sabrían que hay contenido nuevo que bajar.
      _markFileSynced(entry.id, ts);
      _fbSync('hb_fs6', loadFS());
    })
    .catch(function(){ /* si falla, el usuario aún puede sincronizar todo manualmente con ☁️ */ });
}

// Drag for the stats section photo (receives portero object directly)
function attachStatsDrag(p){
  var c=document.getElementById('portero-photo-display');
  var img=document.getElementById('portero-photo-img');
  if(!c||!img||!p) return;
  // Use a flag on the element to avoid adding duplicate listeners
  if(c._dragAttached) return;
  c._dragAttached = true;
  var drag=false,sx=0,sy=0,sox=0,soy=0,curP=p;
  // Expose a way to update the portero reference when filter changes
  c._setPortero=function(newP){curP=newP;};
  var start=function(x,y){drag=true;sx=x;sy=y;sox=curP.ox||50;soy=curP.oy||20;c.style.cursor='grabbing';};
  var move=function(x,y){
    if(!drag)return;
    curP.ox=Math.max(0,Math.min(100,sox-(x-sx)*0.5));
    curP.oy=Math.max(0,Math.min(100,soy-(y-sy)*0.5));
    img.style.objectPosition=curP.ox+'% '+curP.oy+'%';
  };
  var end=function(){if(drag){drag=false;c.style.cursor='grab';}};
  c.style.cursor='grab';
  c.addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();start(e.clientX,e.clientY);});
  document.addEventListener('mousemove',function(e){if(drag)move(e.clientX,e.clientY);});
  document.addEventListener('mouseup',end);
  c.addEventListener('touchstart',function(e){e.stopPropagation();var t=e.touches[0];start(t.clientX,t.clientY);},{passive:true});
  c.addEventListener('touchmove',function(e){if(drag){var t=e.touches[0];move(t.clientX,t.clientY);}},{passive:true});
  c.addEventListener('touchend',end,{passive:true});
}

// ===== RESET STATE (used by createNewMatch) =====
function resetAppState(){
  stopTimer(); timerSeconds=0; realSeconds=0; realStartTs=null; xpsMargins=_xpsDefaultMargins();
  // Restore last used porteros (names+photos), reset their stats
  var lastP=null;
  try{ lastP=JSON.parse(localStorage.getItem('hb_last_porteros')); }catch(e){}
  if(lastP&&lastP.length>=2){
    porteros=lastP.map(function(p){return{id:p.id,name:p.name,dorsal:p.dorsal||'',photo:null,seconds:0,ox:p.ox||50,oy:p.oy||20};});
    rehydratePhotos(porteros);
    nextPid=Math.max.apply(null,porteros.map(function(p){return p.id;}))+1;
  } else {
    porteros=[{id:1,name:'Portero 1',dorsal:'',photo:null,seconds:0,ox:50,oy:20},{id:2,name:'Portero 2',dorsal:'',photo:null,seconds:0,ox:50,oy:20}];
    nextPid=3;
  }
  attackers=[]; selectedAttacker=null; shots=[]; ownGoals=[]; currentMatchId=null; currentMatchDate=null;
  filterPortero='all'; filterPlayer='all'; filterHalf='all';
  selectedZone=null; selectedGoalPos=null; selectedResult=null; activePorteroId=1; selectedDeflected=false; selectedRebote=false;
  dosEquipos=false; activePorteroId2=null; equipoRecibe=1; teamNames=['Equipo 1','Equipo 2'];
  scoreUs=0; scoreThem=0; scoreSwapped=false;
  applyDosUI();
  document.getElementById('score-us').textContent='0'; document.getElementById('score-them').textContent='0';
  applyScoreSwap(false);
  // Restore last used title and logo
  var lastTitle=localStorage.getItem('hb_last_title')||'REAL FEDERACIÓN ESPAÑOLA DE BALONMANO';
  var lastLogo=localStorage.getItem('hb_last_logo');
  document.getElementById('main-title').textContent=lastTitle;
  var logoImg=document.getElementById('logo-img'); var logoPlus=document.getElementById('logo-plus');
  if(lastLogo){
    logoImg.src=lastLogo; logoImg.style.display='block'; logoPlus.style.display='none';
  } else {
    logoImg.src=''; logoImg.style.display='none'; logoPlus.style.display='block';
  }
  document.getElementById('rival-name').value='';
  document.getElementById('timer-status').textContent='Cronómetro detenido';
  document.querySelectorAll('[data-zone]').forEach(function(b){
    var sp=b.dataset.zone==='7 metros'||b.dataset.zone==='Contraataque';
    b.style.background=sp?'rgba(120,70,0,.4)':'rgba(15,40,90,.75)';
    b.style.borderColor=sp?'rgba(245,158,11,.9)':'rgba(255,255,255,.5)';
    b.style.color=sp?'#fbbf24':'#fff'; b.style.boxShadow='none';
  });
  document.querySelectorAll('.gcell').forEach(function(b){b.style.background=b.classList.contains('gcell-fuera')?'rgba(239,68,68,.10)':'rgba(255,255,255,.06)';b.style.boxShadow='none';});
  document.querySelectorAll('.btn-result').forEach(function(b){b.classList.remove('selected');});
  var lz=document.getElementById('zone-active-lbl'); if(lz) lz.textContent='Sin zona seleccionada';
  var gl=document.getElementById('goal-active-lbl'); if(gl) gl.textContent='Sin posición seleccionada';
  // Switch to registro tab
  document.querySelectorAll('.section').forEach(function(s){s.classList.remove('active');});
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  document.getElementById('sec-registro').classList.add('active');
  var tabs=document.querySelectorAll('.tab'); if(tabs.length) tabs[0].classList.add('active');
  otrasContribs=[];
  renderOfensiva();
  updateTimerDisplay(); updateRealTimerDisplay(); renderPorteros(); renderAttackers(); renderLog(); renderStats(); renderFilterBars();
  document.getElementById('register-btn').disabled=true;
}

// ===== FILE EXPLORER =====
function openExplorer(){
  explorerFolder=null; renderExplorer();
  document.getElementById('explorer-overlay').classList.remove('hidden');
}
function closeExplorer(){
  document.getElementById('explorer-overlay').classList.add('hidden');
}
function explorerUp(){
  if(explorerFolder===null) return;
  var fs=loadFS();
  var f=fs.folders.find(function(x){return x.id===explorerFolder;});
  explorerFolder=f?f.parentId:null; renderExplorer();
}

function renderExplorer(){
  var fsData=loadFS();
  var grid=document.getElementById('explorer-grid'); grid.innerHTML='';
  // Breadcrumb
  var bc=document.getElementById('exp-breadcrumb');
  if(explorerFolder===null){
    bc.innerHTML=''; var sp=document.createElement('span'); sp.style.color='var(--text)'; sp.textContent='Inicio'; bc.appendChild(sp);
  } else {
    var path=[],cur=explorerFolder;
    while(cur!==null){var fnd=fsData.folders.find(function(x){return x.id===cur;});if(!fnd)break;path.unshift(fnd);cur=fnd.parentId;}
    bc.innerHTML='';
    var home=document.createElement('span'); home.style.cssText='cursor:pointer;color:var(--blue2)';
    home.textContent='Inicio'; home.onclick=function(){explorerFolder=null;renderExplorer();}; bc.appendChild(home);
    path.forEach(function(p){
      var sep=document.createTextNode(' › '); bc.appendChild(sep);
      var sp=document.createElement('span'); sp.style.cssText='cursor:pointer;color:var(--blue2)';
      sp.textContent=p.name; sp.onclick=(function(pid){return function(){explorerFolder=pid;renderExplorer();};})(p.id); bc.appendChild(sp);
    });
  }
  var btnUp=document.getElementById('btn-up');
  btnUp.disabled=(explorerFolder===null); btnUp.style.opacity=explorerFolder===null?'0.35':'1';

  var folders=fsData.folders.filter(function(f){return f.parentId===explorerFolder && !f.trashedAt;});
  folders.sort(function(a,b){return (a.order||0)-(b.order||0);});
  var files=fsData.files.filter(function(f){return f.parentId===explorerFolder && !f.trashedAt;});
  files.sort(function(a,b){return (a.order||0)-(b.order||0);});

  // Drop zone to parent
  if(explorerFolder!==null){
    var dz=document.createElement('div'); dz.className='drop-zone-root';
    dz.textContent='⬆ Soltar aquí para mover a carpeta superior';
    setupDropTarget(dz,function(type,id){
      var parentF=fsData.folders.find(function(x){return x.id===explorerFolder;});
      moveItem(type,id,parentF?parentF.parentId:null);
    });
    grid.appendChild(dz);
  }

  if(!folders.length&&!files.length){
    var em=document.createElement('div'); em.className='explorer-empty';
    em.innerHTML=explorerFolder===null
      ?'📂 No hay partidos guardados todavía<br><small>Usa "💾 Guardar partido"</small>'
      :'📂 Carpeta vacía<br><small>Arrastra archivos aquí</small>';
    grid.appendChild(em); return;
  }

  folders.forEach(function(folder){
    var nF=fsData.folders.filter(function(x){return x.parentId===folder.id && !x.trashedAt;}).length;
    var nFi=fsData.files.filter(function(x){return x.parentId===folder.id && !x.trashedAt;}).length;
    var meta=[nF&&(nF+' carpeta'+(nF>1?'s':'')),nFi&&(nFi+' partido'+(nFi>1?'s':''))].filter(Boolean).join(', ')||'Vacía';
    var item=document.createElement('div'); item.className='explorer-item'; item.draggable=true;
    // Icon
    var icon=document.createElement('span'); icon.className='ei-icon'; icon.textContent='📁'; item.appendChild(icon);
    // Name
    var nameEl=document.createElement('span'); nameEl.className='ei-name'; nameEl.id='fn-'+folder.id; nameEl.textContent=folder.name; item.appendChild(nameEl);
    // Meta
    var metaEl=document.createElement('span'); metaEl.className='ei-meta'; metaEl.textContent=meta; item.appendChild(metaEl);
    // Actions
    var acts=document.createElement('span'); acts.className='ei-acts';
    var bSum=document.createElement('button'); bSum.className='iact'; bSum.title='Ver resumen de temporada'; bSum.style.cssText='color:var(--gold);font-size:11px;font-weight:600;padding:3px 8px;border:1px solid rgba(245,158,11,.4);border-radius:5px;white-space:nowrap';bSum.textContent='📊 Temporada';
    bSum.onclick=(function(fid,fname){return function(e){e.stopPropagation();openSeasonSummary(fid,fname);};})(folder.id,folder.name); acts.appendChild(bSum);
    var bMove=document.createElement('button'); bMove.className='move-btn'; bMove.title='Mover a...'; bMove.textContent='📁';
    bMove.onclick=(function(fid){return function(e){e.stopPropagation();showMoveDialog('folder',fid);};})(folder.id); acts.appendChild(bMove);
    var bRen=document.createElement('button'); bRen.className='iact'; bRen.title='Renombrar'; bRen.textContent='✏️';
    bRen.onclick=(function(fid){return function(e){e.stopPropagation();startRename('folder',fid);};})(folder.id); acts.appendChild(bRen);
    var bDel=document.createElement('button'); bDel.className='iact del'; bDel.title='Eliminar'; bDel.textContent='🗑';
    bDel.onclick=(function(fid){return function(e){e.stopPropagation();deleteItem('folder',fid);};})(folder.id); acts.appendChild(bDel);
    item.appendChild(acts);
    setupDragSource(item,'folder',folder.id);
    setupReorderDrop(item,'folder',folder.id,folders);
    setupDropTarget(item,(function(fid){return function(type,id){if(type==='folder'&&id===fid)return;moveItem(type,id,fid);};})(folder.id));
    item.ondblclick=function(){explorerFolder=folder.id;renderExplorer();};
    item.onclick=function(e){if(e.target.tagName==='BUTTON')return;selectExplorerItem(item);};
    grid.appendChild(item);
  });

  files.forEach(function(file){
    var d=new Date(file.date).toLocaleDateString('es-ES');
    var isCur=file.id===currentMatchId;
    var item=document.createElement('div'); item.className='explorer-item'+(isCur?' current':''); item.draggable=true;
    var icon=document.createElement('span'); icon.className='ei-icon'; icon.textContent=isCur?'📋✓':'📋'; item.appendChild(icon);
    var nameEl=document.createElement('span'); nameEl.className='ei-name'; nameEl.id='fn-'+file.id; nameEl.textContent=file.name; item.appendChild(nameEl);
    var metaEl=document.createElement('span'); metaEl.className='ei-meta'; metaEl.textContent=d;
    metaEl.title='Doble clic para editar fecha';
    metaEl.ondblclick=(function(fid,el){return function(e){
      e.stopPropagation();
      var fsData=loadFS(); var f2=fsData.files.find(function(x){return x.id===fid;}); if(!f2)return;
      var inp=document.createElement('input'); inp.type='date'; inp.value=new Date(f2.date).toISOString().slice(0,10);
      inp.style.cssText='font-size:11px;padding:2px 4px;border-radius:4px;border:1px solid var(--blue2);background:var(--navy3);color:var(--white);width:120px';
      inp.onclick=function(ev){ev.stopPropagation();};
      inp.onblur=function(){
        if(inp.value&&inp.value.match(/^\d{4}-\d{2}-\d{2}$/)){
          f2.date=new Date(inp.value+'T12:00:00').toISOString();
          if(f2.data)f2.data.date=f2.date; saveFS(fsData);
          el.textContent=new Date(f2.date).toLocaleDateString('es-ES');
        }
        if(inp.parentNode)inp.parentNode.replaceChild(el,inp);
      };
      inp.onkeydown=function(ev){if(ev.key==='Enter')inp.blur();if(ev.key==='Escape'&&inp.parentNode)inp.parentNode.replaceChild(el,inp);};
      el.parentNode.replaceChild(inp,el); inp.focus();
    };})(file.id, metaEl);
    item.appendChild(metaEl);
    var acts=document.createElement('span'); acts.className='ei-acts';
    var bMove=document.createElement('button'); bMove.className='move-btn'; bMove.title='Mover a...'; bMove.textContent='📁';
    bMove.onclick=(function(fid){return function(e){e.stopPropagation();showMoveDialog('file',fid);};})(file.id); acts.appendChild(bMove);
    var bRen=document.createElement('button'); bRen.className='iact'; bRen.title='Renombrar'; bRen.textContent='✏️';
    bRen.onclick=(function(fid){return function(e){e.stopPropagation();startRename('file',fid);};})(file.id); acts.appendChild(bRen);
    var bDel=document.createElement('button'); bDel.className='iact del'; bDel.title='Eliminar'; bDel.textContent='🗑';
    bDel.onclick=(function(fid){return function(e){e.stopPropagation();deleteItem('file',fid);};})(file.id); acts.appendChild(bDel);
    item.appendChild(acts);
    setupDragSource(item,'file',file.id);
    setupReorderDrop(item,'file',file.id,files);
    item.ondblclick=function(){openMatch(file.id);};
    item.onclick=function(e){if(e.target.tagName==='BUTTON')return;selectExplorerItem(item);};
    grid.appendChild(item);
  });
}

function selectExplorerItem(item){
  document.querySelectorAll('.explorer-item').forEach(function(i){i.classList.remove('current');});
  item.classList.add('current');
}
function setupReorderDrop(el, type, id, siblingArray){
  el.addEventListener('dragover', function(e){
    // Only handle same-type reorder (not cross-type moves)
    var dragging = document.querySelector('.explorer-item[data-dragging]');
    if(!dragging) return;
    if(dragging.dataset.dtype !== type) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    // Determine above or below based on cursor position
    var rect=el.getBoundingClientRect();
    var mid=rect.top+rect.height/2;
    document.querySelectorAll('.drop-above,.drop-below').forEach(function(x){
      x.classList.remove('drop-above','drop-below');
    });
    if(e.clientY < mid) el.classList.add('drop-above');
    else el.classList.add('drop-below');
  });
  el.addEventListener('dragleave', function(){
    el.classList.remove('drop-above','drop-below');
  });
  el.addEventListener('drop', function(e){
    var above=el.classList.contains('drop-above');
    el.classList.remove('drop-above','drop-below');
    var raw=e.dataTransfer.getData('text/plain');
    if(!raw) return;
    var dragged;
    try{ dragged=JSON.parse(raw); }catch(err){ return; }
    if(dragged.type!==type || dragged.id===id) return;
    // stopPropagation() por sí solo NO basta: setupDropTarget() registra su propio
    // listener de "drop" en este MISMO elemento (para mover dentro de la carpeta), y
    // stopPropagation() solo frena la subida a elementos padres, no a otro listener del
    // mismo elemento — así que sin stopImmediatePropagation() se disparaban los dos a la
    // vez (reordenar Y mover dentro), pudiendo anidar una carpeta sin que el usuario lo
    // pidiera con solo arrastrar cerca del borde de otra carpeta.
    e.stopPropagation(); e.stopImmediatePropagation();
    // Reorder: rebuild order values
    var fsData=loadFS();
    var arr = type==='folder'
      ? fsData.folders.filter(function(x){return x.parentId===explorerFolder;})
      : fsData.files.filter(function(x){return x.parentId===explorerFolder;});
    arr.sort(function(a,b){return (a.order||0)-(b.order||0);});
    // Remove dragged from array
    var draggedItem=arr.find(function(x){return x.id===dragged.id;});
    var targetItem=arr.find(function(x){return x.id===id;});
    if(!draggedItem||!targetItem) return;
    arr=arr.filter(function(x){return x.id!==dragged.id;});
    var targetIdx=arr.indexOf(targetItem);
    if(above) arr.splice(targetIdx,0,draggedItem);
    else arr.splice(targetIdx+1,0,draggedItem);
    // Write new order values back
    arr.forEach(function(x,i){x.order=i;});
    saveFS(fsData);
    renderExplorer();
  });
}
function setupDragSource(el,type,id){
  // 2026-09-21: una pulsación larga (táctil) o clic derecho sobre un partido/carpeta abría el menú
  // contextual del navegador (guardar, imprimir, compartir...) justo al empezar a arrastrar. Se
  // suprime salvo dentro de un campo de texto (renombrar), donde sí sirve para copiar/pegar.
  el.addEventListener('contextmenu',function(e){
    var t=e.target&&e.target.tagName;
    if(t==='INPUT'||t==='TEXTAREA') return;
    e.preventDefault();
  });
  el.addEventListener('dragstart',function(e){
    e.dataTransfer.setData('text/plain',JSON.stringify({type:type,id:id}));
    el.style.opacity='0.4';
    el.dataset.dragging='1'; el.dataset.dtype=type;
  });
  el.addEventListener('dragend',function(){
    el.style.opacity='1';
    delete el.dataset.dragging; delete el.dataset.dtype;
    document.querySelectorAll('.drop-above,.drop-below').forEach(function(x){
      x.classList.remove('drop-above','drop-below');
    });
  });
}
function setupDropTarget(el,onDrop){
  el.addEventListener('dragover',function(e){e.preventDefault();el.classList.add('drag-over');});
  el.addEventListener('dragleave',function(){el.classList.remove('drag-over');});
  el.addEventListener('drop',function(e){
    e.preventDefault(); el.classList.remove('drag-over');
    try{
      var data=JSON.parse(e.dataTransfer.getData('text/plain'));
      onDrop(data.type,data.id);
    }catch(err){}
  });
}

function moveItem(type,id,targetFolderId){
  var fs=loadFS();
  if(type==='folder'){
    // Prevent moving into own subtree
    var cur=targetFolderId, forbidden=false;
    while(cur!==null){
      if(cur===id){forbidden=true;break;}
      var par=fs.folders.find(function(x){return x.id===cur;});
      cur=par?par.parentId:null;
    }
    if(forbidden){notify('No puedes mover una carpeta dentro de sí misma',true);return;}
    var fol=fs.folders.find(function(x){return x.id===id;}); if(fol) fol.parentId=targetFolderId;
  } else {
    var fil=fs.files.find(function(x){return x.id===id;}); if(fil) fil.parentId=targetFolderId;
  }
  saveFS(fs); renderExplorer(); notify('✅ Movido');
}

function getFolderList(excludeId){
  var fs=loadFS();
  var forbidden={};
  if(excludeId){
    var stack=[excludeId];
    while(stack.length){
      var cur=stack.shift(); forbidden[cur]=true;
      fs.folders.forEach(function(f){if(f.parentId===cur)stack.push(f.id);});
    }
  }
  // Build flat list iteratively (no nested function)
  var list=[{id:null,name:'Inicio (raíz)',depth:0,label:'0. Inicio (raiz)'}], n=1;
  var queue=[{parentId:null,depth:0}];
  while(queue.length){
    var item=queue.shift();
    var children=fs.folders.filter(function(f){return f.parentId===item.parentId&&!forbidden[f.id]&&!f.trashedAt;});
    children.forEach(function(f){
      var prefix=''; for(var i=0;i<item.depth;i++) prefix+='  ';
      list.push({id:f.id, name:f.name, depth:item.depth, label:n+'. '+prefix+'Carpeta: '+f.name});
      n++; queue.push({parentId:f.id,depth:item.depth+1});
    });
  }
  return list;
}
// Antes esto era un prompt() de texto plano pidiendo escribir un número de una lista
// larguísima — se sustituye por un árbol clicable (misma lógica de exclusión de
// getFolderList, que ya impedía mover una carpeta dentro de sí misma).
var _moveDialogCtx = null;
function showMoveDialog(type,id){
  _moveDialogCtx = {type:type, id:id};
  var list = getFolderList(type==='folder'?id:null);
  var container = document.getElementById('move-dialog-list');
  container.innerHTML = '';
  list.forEach(function(d){
    var row = document.createElement('div');
    row.className = 'move-dialog-row';
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px;padding-left:'+(10+d.depth*20)+'px;cursor:pointer;border-radius:6px;font-size:13px;color:var(--white)';
    row.innerHTML = (d.id===null ? '🏠 ' : '📁 ') + escHtml(d.name);
    row.onmouseover = function(){ row.style.background='rgba(37,99,235,.25)'; };
    row.onmouseout  = function(){ row.style.background='transparent'; };
    row.onclick = (function(targetId){ return function(){
      moveItem(_moveDialogCtx.type, _moveDialogCtx.id, targetId);
      closeMoveDialog();
    }; })(d.id);
    container.appendChild(row);
  });
  document.getElementById('move-dialog-overlay').classList.remove('hidden');
}
function closeMoveDialog(){
  document.getElementById('move-dialog-overlay').classList.add('hidden');
  _moveDialogCtx = null;
}

function createFolder(){
  var fs=loadFS(), id='folder_'+Date.now();
  fs.folders.push({id:id,name:'Nueva carpeta',parentId:explorerFolder});
  saveFS(fs); renderExplorer();
  setTimeout(function(){startRename('folder',id);},80);
}

// ¿El partido abierto es uno recién creado y todavía vacío (sin ningún evento, sin rival, 0-0)?
// (2026-09-21) Cada pulsación de "＋ Nuevo partido" creaba SIEMPRE un archivo nuevo al instante, con
// el último título y la fecha de hoy como nombre — así que pulsarlo dos veces, o abrirlo y
// arrepentirse, dejaba archivos vacíos con el MISMO nombre que el partido anterior del día.
function _currentMatchIsEmptyDraft(){
  if(!currentMatchId) return false;
  if(shots.length||ownGoals.length||otrasContribs.length||scoreUs||scoreThem) return false;
  var rv=document.getElementById('rival-name'); if(rv&&rv.value.trim()) return false;
  var f=loadFS().files.find(function(x){return x.id===currentMatchId;});
  return !!(f && !f.trashedAt);
}
function createNewMatch(){
  if(shots.length>0&&!confirm('¿Crear nuevo partido? Los datos no guardados se perderán.')) return;
  var reuse=_currentMatchIsEmptyDraft() ? {id:currentMatchId,date:currentMatchDate} : null;
  closeExplorer();
  resetAppState();
  // Si ya había un borrador vacío, se reutiliza en vez de crear otro archivo igual.
  if(reuse){ currentMatchId=reuse.id; currentMatchDate=reuse.date; }
  // Asigna currentMatchId y persiste ya desde el primer segundo (ver autosaveMatchLocal),
  // para que un cierre inesperado de la app no deje el partido sin ningún rastro local.
  autosaveMatchLocal();
  notify(reuse?'✅ Ya tenías un partido nuevo vacío: se reutiliza':'✅ Nuevo partido creado');
}

function openMatch(fileId){
  var fs=loadFS();
  var file=fs.files.find(function(f){return f.id===fileId;});
  if(!file){notify('Partido no encontrado',true);return;}
  if(shots.length>0&&!confirm('¿Abrir "'+file.name+'"? Los datos no guardados se perderán.')) return;
  loadMatchData(file.data);
  closeExplorer();
  notify('📂 '+file.name);
}

function startRename(type,id){
  var el=document.getElementById('fn-'+id); if(!el) return;
  var oldName=el.textContent; el.innerHTML='';
  var inp=document.createElement('input'); inp.className='name-edit'; inp.value=oldName;
  el.appendChild(inp); inp.focus(); inp.select();
  inp.addEventListener('click',function(e){e.stopPropagation();});
  var done=false;
  var save=function(){
    if(done) return; done=true;
    var newName=inp.value.trim()||oldName;
    var fs=loadFS();
    if(type==='folder'){var fRen=fs.folders.find(function(x){return x.id===id;});if(fRen)fRen.name=newName;}
    else{var fRen=fs.files.find(function(x){return x.id===id;});if(fRen){fRen.name=newName;fRen.autoNamed=false;}} // renombrado a mano: ya no se regenera solo (ver _buildFileEntry)
    saveFS(fs); renderExplorer();
  };
  inp.addEventListener('blur',save);
  inp.addEventListener('keydown',function(e){
    if(e.key==='Enter') inp.blur();
    if(e.key==='Escape'){done=true;renderExplorer();}
  });
}

// Borra en segundo plano los documentos de partido en Firestore que ya no
// existen localmente, para que no queden acumulados para siempre en la nube.
function _fbDeleteMatchDocs(fileIds){
  if(!window._fbReady || !window._fbDb || !window._fbDeleteDoc || !fileIds.length) return;
  fileIds.forEach(function(fid){
    window._fbDeleteDoc(window._fbDoc(window._fbDb,'sync','hb_file_'+fid)).catch(function(){});
  });
}

// ===== PAPELERA (2026-09-15) =====
// Antes "Eliminar" borraba ya, local Y remoto, sin posibilidad de deshacer — un clic de
// más y no había vuelta atrás. Ahora se mueve a una papelera local (30 días) antes de
// borrarse de verdad: _fbDeleteMatchDocs (que sí borra el documento real en Firestore) ya
// NO se llama aquí, se difiere a _purgeOldTrash(). La papelera es SOLO LOCAL a propósito
// (no se sincroniza entre dispositivos): sincronizarla bien exigiría tocar de nuevo la
// fusión de hb_structure para que un "borrado" se propague como tal y no como "a este
// dispositivo aún le falta este partido" (que es justo la ambigüedad que hay que evitar
// tras el incidente) — se puede añadir más adelante si hace falta, pero de momento prima
// la sencillez y no tocar más la capa de sync ya arreglada.
var TRASH_RETENTION_MS = 30*24*60*60*1000; // 30 días
function _trashId(){ return 'trash_'+Date.now()+'_'+Math.random().toString(36).slice(2); }

// ── Papelera sincronizada entre dispositivos (2026-09-20) ────────────────────────────────
// ANTES: "Eliminar" sacaba el partido/carpeta de fsData.files/folders y lo guardaba en un
// array fsData.trash SOLO LOCAL, que nunca se subía a la nube. Como la sincronización solo
// sabe AÑADIR lo que la nube tiene y el dispositivo no (nunca sabe si "falta" es "aún no me
// ha llegado" o "lo borré a propósito"), el partido volvía a descargarse en cuanto se
// sincronizaba de nuevo — el bug real reportado el 2026-09-20 ("lo borro y vuelve a
// aparecer"). Fix: en vez de sacar el partido/carpeta de su array, se marca en el propio
// objeto (trashedAt/trashId/stateTs) y se DEJA en fsData.files/folders — así viaja por el
// mismo canal de sincronización ya probado (fileTs, merge por fecha) sin inventar nada
// nuevo. renderExplorer() oculta lo marcado; renderTrash() lo muestra agrupado por trashId.
// Restaurar/purgar son las ÚNICAS acciones que tocan trashedAt — nunca la fusión de sync por
// su cuenta, así que un partido solo sale de la papelera si el usuario lo pide, en cualquier
// dispositivo (se propaga porque gana el mayor stateTs, igual que el resto de fusiones).
function deleteItem(type,id){
  var fsData=loadFS();
  var now=Date.now(), trashId=_trashId();
  var affectedFileIds=[];
  if(type==='folder'){
    var folder = fsData.folders.find(function(f){return f.id===id;});
    if(!folder) return;
    var toDeleteFolders={};
    var stack=[id];
    while(stack.length){
      var cur=stack.pop();
      toDeleteFolders[cur]=true;
      fsData.folders.forEach(function(f){if(f.parentId===cur && !toDeleteFolders[f.id]) stack.push(f.id);});
    }
    var affectedFolders = fsData.folders.filter(function(f){return toDeleteFolders[f.id];});
    var affectedFiles = fsData.files.filter(function(f){return toDeleteFolders[f.parentId] && !f.trashedAt;});
    var nF=affectedFolders.length-1, nP=affectedFiles.length;
    var detalle = [nP&&(nP+' partido'+(nP!==1?'s':'')), nF>0&&(nF+' subcarpeta'+(nF!==1?'s':''))].filter(Boolean).join(' y ') || 'vacía';
    if(!confirm('¿Eliminar "'+folder.name+'" ('+detalle+')?\nPodrás recuperarla desde la Papelera durante 30 días.')) return;
    affectedFolders.forEach(function(f){ f.trashedAt=now; f.trashId=trashId; f.stateTs=now; f.isTrashRoot=(f.id===id); });
    affectedFiles.forEach(function(f){ f.trashedAt=now; f.trashId=trashId; f.stateTs=now; affectedFileIds.push(f.id); });
    // Si el partido que tenías abierto estaba dentro de esta carpeta, hay que soltar
    // currentMatchId igual que ya hace la rama de abajo al borrar un partido suelto — si no,
    // el próximo autoguardado (o cualquier guardado manual posterior) reconstruye su entrada
    // con _buildFileEntry() y, sin este aviso, "resucitaría" ese partido concreto fuera de la
    // papelera en este mismo dispositivo (bug real, 2026-09-24).
    if(currentMatchId && affectedFileIds.indexOf(currentMatchId)>=0) currentMatchId=null;
  } else {
    var file = fsData.files.find(function(f){return f.id===id;});
    if(!file) return;
    if(!confirm('¿Eliminar "'+file.name+'"?\nPodrás recuperarlo desde la Papelera durante 30 días.')) return;
    file.trashedAt=now; file.trashId=trashId; file.stateTs=now; file.isTrashRoot=true;
    affectedFileIds.push(file.id);
    if(currentMatchId===id) currentMatchId=null;
  }
  saveFS(fsData); renderExplorer();
  // Empuja de inmediato el cambio (igual que hace saveMatch() al guardar un partido), para
  // que la papelera se vea en otros dispositivos sin esperar a la próxima sincronización
  // completa.
  affectedFileIds.forEach(function(fid){
    var f=fsData.files.find(function(x){return x.id===fid;});
    if(f) syncSingleMatchToCloud(f);
  });
  notify(type==='folder'?'🗑 Carpeta movida a la papelera':'🗑 Partido movido a la papelera');
}

function restoreTrashItem(trashId){
  var fsData=loadFS();
  var now=Date.now();
  var files = fsData.files.filter(function(f){return f.trashId===trashId;});
  var folders = fsData.folders.filter(function(f){return f.trashId===trashId;});
  if(!files.length && !folders.length) return;
  var rootFolder = folders.find(function(f){return f.isTrashRoot;});
  if(rootFolder && rootFolder.parentId!==null && !fsData.folders.some(function(f){return f.id===rootFolder.parentId && !f.trashedAt;})){
    // Si la carpeta padre original ya no existe (también se borró y ya se purgó), se
    // restaura en la raíz en vez de perderse o quedar huérfana sin sitio donde navegar.
    rootFolder.parentId = null;
  }
  files.forEach(function(f){ f.trashedAt=null; f.trashId=null; f.stateTs=now; });
  folders.forEach(function(f){ f.trashedAt=null; f.trashId=null; f.stateTs=now; f.isTrashRoot=false; });
  saveFS(fsData); renderExplorer();
  try{ renderTrash(); }catch(e){}
  files.forEach(function(f){ syncSingleMatchToCloud(f); });
  notify('♻️ Restaurado');
}

function purgeTrashItemNow(trashId){
  if(!confirm('¿Eliminar definitivamente? No podrás recuperarlo después.')) return;
  var fsData=loadFS();
  var files = fsData.files.filter(function(f){return f.trashId===trashId;});
  var folders = fsData.folders.filter(function(f){return f.trashId===trashId;});
  if(!files.length && !folders.length) return;
  var removedFileIds = files.map(function(f){return f.id;});
  var removedFolderIds = folders.map(function(f){return f.id;});
  var now=Date.now();
  fsData.purgedIds = fsData.purgedIds || {};
  removedFileIds.concat(removedFolderIds).forEach(function(pid){ fsData.purgedIds[pid]=now; });
  fsData.files = fsData.files.filter(function(f){return f.trashId!==trashId;});
  fsData.folders = fsData.folders.filter(function(f){return f.trashId!==trashId;});
  saveFS(fsData);
  _fbDeleteMatchDocs(removedFileIds);
  try{ renderTrash(); }catch(e){}
  renderExplorer();
  notify('🗑 Eliminado definitivamente');
}
// ===== COPIAS DE SEGURIDAD SILENCIOSAS (2026-09-15) =====
// Instantánea completa de partidos+rivales guardada en IndexedDB, sin preguntar nada ni
// descargar ningún fichero (a diferencia de exportData(), que abre un diálogo de descarga
// del navegador). Es la última red de seguridad si algún día hb_structure/hb_rivals6
// volvieran a corromperse: NO depende de Firebase ni de reconstruir nada a mano.
var SNAPSHOT_MAX = 7; // una por día, guarda la última semana
function _takeSnapshotIfNeeded(){
  _idbGet('hb_snapshots', function(list){
    list = list || [];
    var today = new Date().toISOString().slice(0,10);
    var lastDay = list.length ? new Date(list[list.length-1].ts).toISOString().slice(0,10) : null;
    if(lastDay === today) return; // ya hay una de hoy
    list.push({ id:'snap_'+Date.now(), ts:Date.now(), fsCache: loadFS(), rivalsFSCache: _rivalsFSCache || {folders:[],teams:[]} });
    while(list.length > SNAPSHOT_MAX) list.shift();
    _idbSet('hb_snapshots', list);
  });
}
function restoreSnapshot(snapId){
  if(!confirm('¿Restaurar esta copia de seguridad? Sustituirá los partidos y rivales actuales por los de ese día (se guarda antes una copia del estado actual, por si acaso).')) return;
  _idbGet('hb_snapshots', function(list){
    list = list || [];
    var snap = list.find(function(s){ return s.id===snapId; });
    if(!snap) return;
    // Por si acaso: guarda el estado ACTUAL como una instantánea más antes de sobrescribir,
    // para que restaurar nunca sea una vía sin retorno.
    list.push({ id:'snap_'+Date.now(), ts:Date.now(), fsCache: loadFS(), rivalsFSCache: _rivalsFSCache || {folders:[],teams:[]} });
    while(list.length > SNAPSHOT_MAX) list.shift();
    _idbSet('hb_snapshots', list);

    saveFS(snap.fsCache);
    saveRivalsFS2(snap.rivalsFSCache);
    renderExplorer();
    try{ renderRivalsDir(); }catch(e){}
    try{ renderTrash(); }catch(e){}
    notify('♻️ Copia de seguridad restaurada');
  });
}

// ===== PAPELERA: modal combinado (elementos borrados + copias de seguridad) =====
function openTrash(){
  renderTrash();
  document.getElementById('trash-overlay').classList.remove('hidden');
}
function closeTrash(){
  document.getElementById('trash-overlay').classList.add('hidden');
}
function _daysLeft(deletedAt){
  var ms = TRASH_RETENTION_MS - (Date.now()-deletedAt);
  return Math.max(0, Math.ceil(ms/(24*60*60*1000)));
}
// Agrupa los partidos/carpetas marcados con trashedAt por su trashId compartido, para que
// una carpeta borrada con varios partidos dentro aparezca como UNA sola fila en la papelera
// (igual que antes), en vez de una fila por cada partido/subcarpeta afectado.
function _matchTrashGroups(fsData){
  var groups = {};
  function consider(item, type){
    if(!item.trashId) return;
    var g = groups[item.trashId];
    if(!g || item.isTrashRoot) groups[item.trashId] = {id:item.trashId, type:type, name:item.name, deletedAt:item.trashedAt};
  }
  (fsData.folders||[]).forEach(function(f){ consider(f,'folder'); });
  (fsData.files||[]).forEach(function(f){ consider(f,'file'); });
  return Object.keys(groups).map(function(k){ return groups[k]; });
}
function renderTrash(){
  var list = document.getElementById('trash-list');
  if(list){
    list.innerHTML='';
    var fsTrash = _matchTrashGroups(loadFS());
    var rivalsTrash = ((_rivalsFSCache||{}).trash)||[];
    var items = fsTrash.map(function(t){ return {t:t, kind:'match'}; })
      .concat(rivalsTrash.map(function(t){ return {t:t, kind:'rival'}; }));
    items.sort(function(a,b){ return b.t.deletedAt - a.t.deletedAt; });
    if(!items.length){
      var em=document.createElement('div'); em.style.cssText='font-size:12px;color:var(--gray);padding:10px 0';
      em.textContent='La papelera está vacía.'; list.appendChild(em);
    }
    items.forEach(function(entry){
      var t=entry.t;
      var icon = t.type==='folder' ? '📁' : (entry.kind==='rival' ? '🛡' : '📋');
      var row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--navy2);border:1px solid var(--border);border-radius:8px;font-size:12px';
      row.innerHTML =
        '<span>'+icon+'</span>' +
        '<span style="flex:1;color:var(--white)">'+escHtml(t.name)+'</span>' +
        '<span style="color:var(--gray);font-size:11px">quedan '+_daysLeft(t.deletedAt)+' días</span>';
      var restoreBtn=document.createElement('button'); restoreBtn.className='tbtn'; restoreBtn.style.cssText='font-size:11px;padding:4px 8px';
      restoreBtn.textContent='♻ Restaurar';
      restoreBtn.onclick=(function(id,kind){ return function(){ kind==='rival' ? restoreRivalsTrashItem(id) : restoreTrashItem(id); }; })(t.id, entry.kind);
      var delBtn=document.createElement('button'); delBtn.className='iact del'; delBtn.style.cssText='font-size:11px;padding:4px 8px';
      delBtn.textContent='🗑';
      delBtn.title='Eliminar definitivamente';
      delBtn.onclick=(function(id,kind){ return function(){ kind==='rival' ? purgeRivalsTrashItemNow(id) : purgeTrashItemNow(id); }; })(t.id, entry.kind);
      row.appendChild(restoreBtn); row.appendChild(delBtn);
      list.appendChild(row);
    });
  }
  var slist = document.getElementById('snapshot-list');
  if(slist){
    slist.innerHTML='';
    _idbGet('hb_snapshots', function(snaps){
      snaps = (snaps||[]).slice().sort(function(a,b){ return b.ts-a.ts; });
      if(!snaps.length){
        var em=document.createElement('div'); em.style.cssText='font-size:12px;color:var(--gray)';
        em.textContent='Todavía no hay copias de seguridad (se genera la primera durante las próximas 24h).';
        slist.appendChild(em); return;
      }
      snaps.forEach(function(s){
        var row=document.createElement('div');
        row.style.cssText='display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--navy2);border:1px solid var(--border);border-radius:8px;font-size:12px';
        var nP=(s.fsCache&&s.fsCache.files||[]).length, nR=(s.rivalsFSCache&&s.rivalsFSCache.teams||[]).length;
        row.innerHTML =
          '<span>💾</span>' +
          '<span style="flex:1;color:var(--white)">'+new Date(s.ts).toLocaleString('es-ES')+'</span>' +
          '<span style="color:var(--gray);font-size:11px">'+nP+' partidos, '+nR+' rivales</span>';
        var restoreBtn=document.createElement('button'); restoreBtn.className='tbtn'; restoreBtn.style.cssText='font-size:11px;padding:4px 8px';
        restoreBtn.textContent='♻ Restaurar';
        restoreBtn.onclick=(function(id){ return function(){ restoreSnapshot(id); }; })(s.id);
        row.appendChild(restoreBtn);
        slist.appendChild(row);
      });
    });
  }
}

// Barrido de purga: se llama una vez al arrancar. Todo lo que lleve más de 30 días en la
// papelera se borra ya de verdad (incluyendo el documento real en Firestore, y propagando
// el borrado definitivo a todos los dispositivos vía purgedIds — ver purgeTrashItemNow).
function _purgeOldTrash(){
  var fsData=loadFS();
  var now=Date.now();
  var expiredFileIds = fsData.files.filter(function(f){return f.trashedAt && (now-f.trashedAt>TRASH_RETENTION_MS);}).map(function(f){return f.id;});
  var expiredFolderIds = fsData.folders.filter(function(f){return f.trashedAt && (now-f.trashedAt>TRASH_RETENTION_MS);}).map(function(f){return f.id;});
  if(!expiredFileIds.length && !expiredFolderIds.length) return;
  fsData.purgedIds = fsData.purgedIds || {};
  expiredFileIds.concat(expiredFolderIds).forEach(function(pid){ fsData.purgedIds[pid]=now; });
  var expiredFileSet={}; expiredFileIds.forEach(function(id){expiredFileSet[id]=true;});
  var expiredFolderSet={}; expiredFolderIds.forEach(function(id){expiredFolderSet[id]=true;});
  fsData.files = fsData.files.filter(function(f){return !expiredFileSet[f.id];});
  fsData.folders = fsData.folders.filter(function(f){return !expiredFolderSet[f.id];});
  saveFS(fsData);
  _fbDeleteMatchDocs(expiredFileIds);
}

// ===== EXPORT / IMPORT =====
function exportData(){
  var fsData = loadFS();
  var exportObj = {
    folders: fsData.folders,
    files: fsData.files,
    photos: _photoCache
  };
  var blob = new Blob([JSON.stringify(exportObj, null, 2)], {type:'application/json'});
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  var date = new Date().toLocaleDateString('es-ES').replace(/\//g,'-');
  a.href = url; a.download = 'balonmano_partidos_' + date + '.json';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  notify('⬆ Datos exportados (con ' + Object.keys(_photoCache).length + ' fotos)');
}
function importData(input){
  var file = input.files[0]; if(!file) return;
  var reader = new FileReader();
  reader.onload = function(e){
    try{
      var imported = JSON.parse(e.target.result);
      if(!Array.isArray(imported.folders) || !Array.isArray(imported.files)) throw new Error('Formato incorrecto');
      var current = loadFS();
      var existingFolderIds = {};
      current.folders.forEach(function(f){ existingFolderIds[f.id]=true; });
      var existingFileIds = {};
      current.files.forEach(function(f){ existingFileIds[f.id]=true; });
      var newFolders=0, newFiles=0;
      imported.folders.forEach(function(f){
        if(!existingFolderIds[f.id]){ current.folders.push(f); newFolders++; }
      });
      imported.files.forEach(function(f){
        if(!existingFileIds[f.id]){ current.files.push(f); newFiles++; }
        else {
          var idx = current.files.findIndex(function(x){return x.id===f.id;});
          if(idx>=0 && new Date(f.date) > new Date(current.files[idx].date)){
            current.files[idx]=f; newFiles++;
          }
        }
      });
      // Import photos if present
      var newPhotos = 0;
      if(imported.photos && typeof imported.photos === 'object'){
        Object.keys(imported.photos).forEach(function(name){
          var v = imported.photos[name];
          // Solo aceptar data URLs de imagen reales: v va directo a un atributo src= al
          // renderizar, así que aquí es donde hay que cortar cualquier otra cosa.
          if(!_photoCache[name] && typeof v==='string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(v)){
            _photoCache[name] = v;
            newPhotos++;
          }
        });
        if(newPhotos > 0) _idbSet('hb_photos', _photoCache);
      }
      saveFS(current);
      renderExplorer();
      notify('⬇ Importados: '+newFolders+' carpetas, '+newFiles+' partidos, '+newPhotos+' fotos');
    } catch(err){
      notify('Error al importar: '+err.message, true);
    }
    input.value='';
  };
  reader.readAsText(file);
}

// ===== SEASON SUMMARY =====
function openSeasonSummary(folderId, folderName, jumpTo){
  var fs=loadFS();
  var allFiles=[];
  var seenIds={}; // evitar contar el mismo partido dos veces (duplicados por sync o estructura)
  var visitedFolders={};
  var stack=[folderId];
  while(stack.length){
    var cur=stack.pop();
    if(visitedFolders[cur]) continue; // evitar recorrer la misma carpeta dos veces
    visitedFolders[cur]=true;
    fs.files.forEach(function(f){
      if(f.parentId===cur && !f.trashedAt && !seenIds[f.id]){
        seenIds[f.id]=true;
        // Un archivo sin ningún dato (borrador vacío de "Nuevo partido": sin tiros, sin goles propios,
        // sin contribuciones y 0-0) no es un partido registrado: no cuenta ni sale en la tabla, y no
        // desplaza la numeración de jornadas (2026-09-21, caso "LB2 SUIZA vs ESPAÑA").
        var fd=f.data||{};
        var vacio=!(fd.shots||[]).length && !(fd.ownGoals||[]).length && !(fd.otrasContribs||[]).length && !fd.scoreUs && !fd.scoreThem;
        if(vacio) return;
        allFiles.push(f);
      }
    });
    fs.folders.forEach(function(f){if(f.parentId===cur && !f.trashedAt) stack.push(f.id);});
  }
  if(!allFiles.length){notify('No hay partidos guardados en esta carpeta',true);return;}
  allFiles.sort(function(a,b){
    var da=new Date((a.data&&a.data.date)||a.date||0);
    var db=new Date((b.data&&b.data.date)||b.date||0);
    return da-db;
  });
  var htmlContent = buildSeasonHTML(folderName, allFiles, folderId, jumpTo);
  _openSeasonWindow(htmlContent, folderName);
}

// Abre (ventana nativa NW.js o overlay con iframe en navegador/Android) un HTML de
// resumen ya generado. Lo comparten openSeasonSummary (una carpeta) y openPlayerReport
// (partidos de un mismo rival aunque estén repartidos en varias carpetas/temporadas).
function _openSeasonWindow(htmlContent, titleName){
  // NW.js: write to app folder and open with relative path
  try {
    var nwReq = (typeof nw !== 'undefined' && nw.require) ? nw.require : require;
    var nodeFs = nwReq('fs');
    nodeFs.writeFileSync('hk_season_tmp.html', htmlContent, 'utf8');
    nw.Window.open('hk_season_tmp.html', {
      title:  'Resumen Temporada — ' + titleName,
      width:  1300,
      height: 900,
      frame:  true,
      focus:  true,
      icon:   'logo_hk.png'
    });
    return;
  } catch(e) {}

  // Browser / Android fallback: open in fullscreen overlay iframe
  var overlay = document.getElementById('season-overlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'season-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:#0a1628;display:flex;flex-direction:column';
    var iframe = document.createElement('iframe');
    iframe.id = 'season-iframe';
    iframe.style.cssText = 'flex:1;border:none;width:100%;height:100%';
    overlay.appendChild(iframe);
    document.body.appendChild(overlay);
  }
  var iframe = document.getElementById('season-iframe');
  // Use srcdoc to inject content directly — works in all modern browsers including Android
  iframe.srcdoc = htmlContent;
}
// El botón "Cerrar" de la ventana de resumen vive DENTRO del iframe: window.close() ahí no hace nada,
// así que se cierra el overlay del padre (mismo origen vía srcdoc; postMessage como plan B).
window.addEventListener('message',function(e){
  if(e.data==='hk-close-season'){ var o=document.getElementById('season-overlay'); if(o) o.remove(); }
});

// Ficha de un jugador rival: agrega TODOS los partidos donde aparezca ese rival
// (por nombre, sin importar en qué carpeta/temporada estén guardados) y salta
// directamente a su informe dentro del resumen generado.
function openPlayerReport(attackerId){
  var a=attackers.find(function(x){return x.id===attackerId;}); if(!a) return;
  var rivalName=(document.getElementById('rival-name')||{}).value||'';
  rivalName=rivalName.trim();
  if(!rivalName){ notify('Indica primero el nombre del rival', true); return; }
  var rivalKey=rivalName.toLowerCase();
  var fsD=loadFS();
  var allFiles=fsD.files.filter(function(f){
    return f.data && f.data.rival && f.data.rival.trim().toLowerCase()===rivalKey;
  });
  if(!allFiles.length){ notify('No hay partidos guardados contra '+rivalName, true); return; }
  allFiles.sort(function(x,y){
    var dx=new Date((x.data&&x.data.date)||x.date||0);
    var dy=new Date((y.data&&y.data.date)||y.date||0);
    return dx-dy;
  });
  var playerLabel=(a.dorsal?a.dorsal+' ':'')+a.name;
  var htmlContent = buildSeasonHTML(rivalName, allFiles, 'rival_'+rivalKey, {rival:rivalName, player:playerLabel});
  _openSeasonWindow(htmlContent, rivalName);
}

function safeJSON(obj){
  // El resultado se embebe dentro de un <script> generado como texto; sin este \u00FAltimo
  // replace, un valor que contenga literalmente "</script" (p.ej. el nombre de un
  // atacante o rival) cerrar\u00EDa el bloque de script real y el resto se interpretar\u00EDa
  // como HTML \u2014 el propio archivo ya usa el truco +'</'+'script>' para su propio
  // marcado, pero no proteg\u00EDa los datos que vienen de fuera.
  return JSON.stringify(obj).replace(/[\u0080-\uFFFF]/g,function(c){
    return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);
  }).replace(/<\/script/gi,'<\\/script');
}

function buildSeasonHTML(folderName, files, folderId, jumpTo){
  // ── Extract per-match per-portero stats ──────────────────────────────
  // Map: porteroName -> [{jornada, rival, shots, paradas, lanz, pct}]
  var porteroMap={};
  var matchList=[];
  // Agrupa por nombre de portera ignorando mayúsculas/minúsculas y espacios extra
  // (p.ej. "Marta Mera" vs "MARTA MERA" o "Marta  Mera" no deben salir como personas distintas).
  // Se queda con la primera variante de escritura que ve como nombre a mostrar.
  var _pNameCanon={};
  // Erratas conocidas de nombres que en realidad son la misma persona (distinto de
  // mayúsculas/espacios, que ya cubre la normalización de abajo). Añadir aquí cuando
  // se detecte una portera duplicada por typo, en vez de tocar los partidos guardados.
  var _pNameAliases={ 'goundo gassam':'Goundo Gassama' };
  function _canonPName(n){
    var norm=String(n||'').trim().replace(/\s+/g,' ').toLowerCase();
    if(!norm) return n||'';
    if(_pNameAliases[norm]) return _pNameAliases[norm];
    if(!_pNameCanon[norm]) _pNameCanon[norm]=String(n).trim().replace(/\s+/g,' ');
    return _pNameCanon[norm];
  }

  files.forEach(function(file,idx){
    var data=file.data;
    var rival=data.rival||'J'+(idx+1);
    var jornada='J'+(idx+1)+' '+rival;
    var shots=data.shots||[];
    matchList.push({jornada:jornada, rival:rival, date:data.date, fileId:file.id, shots:shots, porteros:data.porteros||[], otrasContribs:data.otrasContribs||[]});

    // group shots by portero
    var porteroNames={};
    (data.porteros||[]).forEach(function(p){ porteroNames[p.id]=p.name; });

    var byPortero={};
    shots.forEach(function(s){
      if(s.result==='sinportero'||s.porteroId===null) return;
      var name=_canonPName(porteroNames[s.porteroId]||s.porteroName||'Desconocido');
      if(!byPortero[name]) byPortero[name]={lanz:0,paradas:0,goles:0,fuera:0};
      if(s.result!=='fuera') byPortero[name].lanz++;
      if(s.result==='parada') byPortero[name].paradas++;
      if(s.result==='gol') byPortero[name].goles++;
      if(s.result==='fuera') byPortero[name].fuera++;
    });

    Object.keys(byPortero).forEach(function(name){
      if(!porteroMap[name]) porteroMap[name]=[];
      var d=byPortero[name];
      porteroMap[name].push({
        jornada:jornada, rival:rival, date:data.date,
        lanz:d.lanz, paradas:d.paradas, goles:d.goles, fuera:d.fuera,
        pct:d.lanz>0?Math.round(d.paradas/d.lanz*1000)/10:null
      });
    });
  });

  var porteroNames=Object.keys(porteroMap);
  var COLORS=['#f59e0b','#3b82f6','#22c55e','#a78bfa','#f87171','#34d399'];

  // ── Build global stats per portero ──────────────────────────────────
  var globalStats=porteroNames.map(function(name){
    var entries=porteroMap[name];
    var totLanz=0,totPar=0,totGol=0,totFuera=0;
    entries.forEach(function(e){totLanz+=e.lanz;totPar+=e.paradas;totGol+=e.goles;totFuera+=e.fuera;});
    var totSecs=0;
    matchList.forEach(function(m){
      (m.porteros||[]).forEach(function(p){
        if(_canonPName(p.name)===name) totSecs+=(p.seconds||0);
      });
    });
    var photo=_photoCache[name]||null;
    // Get ox/oy from the portero data in the most recent match
    var ox=50,oy=20,porteroId=null;
    for(var mi=matchList.length-1;mi>=0;mi--){
      var mp=(matchList[mi].porteros||[]).find(function(p){return _canonPName(p.name)===name;});
      if(mp){ox=mp.ox||50;oy=mp.oy||20;porteroId=mp.id||null;break;}
    }
    // Dorsal SOLO si es consistente: todos los partidos donde aparece con dorsal usan el mismo
    var dorsals={};
    matchList.forEach(function(m){
      (m.porteros||[]).forEach(function(p){
        var dv=String(p.dorsal==null?'':p.dorsal).trim();
        if(dv && _canonPName(p.name)===name) dorsals[dv]=true;
      });
    });
    var dorsalKeys=Object.keys(dorsals);
    var dorsal=dorsalKeys.length===1?dorsalKeys[0]:'';
    return{name:name,dorsal:dorsal,lanz:totLanz,paradas:totPar,goles:totGol,fuera:totFuera,
           pct:totLanz>0?Math.round(totPar/totLanz*1000)/10:null,
           partidos:entries.length, seconds:totSecs, photo:photo,
           ox:ox, oy:oy, porteroId:porteroId};
  });

  // ── Jornadas for x-axis (union of all jornadas in order) ─────────────
  var jornadaList=matchList.map(function(m){return m.jornada;});
  // Reverse: most recent first (left on chart)
  matchList.reverse();
  jornadaList.reverse();

  // ── Build match summary table rows ───────────────────────────────────
  var matchRows='';
  matchList.forEach(function(m,idx){
    var shots=m.shots||[];
    var totLanz=shots.filter(function(s){return s.result!=='fuera'&&s.result!=='sinportero'&&!s.noGk;}).length;
    var totPar=shots.filter(function(s){return s.result==='parada';}).length;
    var totGol=shots.filter(function(s){return s.result==='gol'||s.result==='sinportero';}).length;
    var totPct=totLanz>0?Math.round(totPar/totLanz*1000)/10:null;
    var pctColor=totPct===null?'#64748b':totPct>=40?'#6366f1':totPct>=35?'#38bdf8':totPct>=30?'#16a34a':totPct>=25?'#86efac':totPct>=20?'#fb923c':'#ef4444';
    var rating=totPct===null?'—':totPct>=40?'EXCEPCIONAL':totPct>=35?'MUY BUENA':totPct>=30?'BUENA':totPct>=25?'CORRECTA':totPct>=20?'MEJORABLE':'MALA';
    function gsaxSmall(shotsArr){
      var g=calcularGSAx(shotsArr,null);
      if(g.gsax===null) return '';
      return ' <small title="GSAx" style="font-size:10px;font-weight:600;color:'+(g.gsax>=0?'#22c55e':'#ef4444')+'">'+(g.gsax>0?'+':'')+g.gsax+'</small>';
    }

    function ratingSelect(fid,autoLabel,autoColor){
      var L=['EXCEPCIONAL','MUY BUENA','BUENA','CORRECTA','MEJORABLE','MALA'];
      return '<select class="mrating" data-fid="'+escHtml(String(fid))+'" data-auto="'+escHtml(autoLabel)+'" data-color="'+autoColor+'" onchange="setMatchRating(this)" title="Valoración: automática según el % de paradas; se puede cambiar a mano">'
        +'<option value="">'+escHtml(autoLabel)+'</option>'
        +L.map(function(l){ return '<option value="'+l+'">'+l+'</option>'; }).join('')
        +'<option value="__auto">↺ Restablecer a automática</option>'
        +'</select>';
    }
    var porterosCells='';
    porteroNames.forEach(function(name){
      var entry=porteroMap[name].find(function(e){return e.jornada===m.jornada;});
      if(entry){
        var c=entry.pct===null?'#64748b':entry.pct>=40?'#6366f1':entry.pct>=35?'#38bdf8':entry.pct>=30?'#16a34a':entry.pct>=25?'#86efac':entry.pct>=20?'#fb923c':'#ef4444';
        var shotsPM=shots.filter(function(s){
          if(s.result==='sinportero'||s.porteroId===null) return false;
          var pn=null; (m.porteros||[]).forEach(function(p){ if(p.id===s.porteroId) pn=p.name; });
          return _canonPName(pn||s.porteroName||'Desconocido')===name;
        });
        porterosCells+='<td style="color:'+c+';font-weight:700;text-align:center;white-space:nowrap">'+(entry.pct!==null?entry.pct+'%':'—')+gsaxSmall(shotsPM)+'<br><small style="color:#64748b;font-weight:400">'+entry.paradas+'/'+entry.lanz+'</small></td>';
      } else {
        porterosCells+='<td style="color:#374151;text-align:center">—</td>';
      }
    });

    var totalMatches = matchList.length;
    matchRows+='<tr>'
      +'<td><span contenteditable="true" spellcheck="false" data-jidx="'+idx+'" onblur="saveJornada(this)" style="color:#94a3b8;font-size:11px;outline:none;border-bottom:1px solid transparent;cursor:text;min-width:14px;display:inline-block" onmouseover="this.style.borderBottomColor=\'rgba(148,163,184,.4)\'" onmouseout="if(document.activeElement!==this)this.style.borderBottomColor=\'transparent\'" onfocus="this.style.borderBottomColor=\'#94a3b8\'" onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}">'+(totalMatches-idx)+'</span></td>'
      +'<td style="font-weight:600;color:#f8fafc"><span contenteditable="true" spellcheck="false" data-idx="'+idx+'" onblur="updateRival(this)" style="outline:none;border-bottom:1px solid transparent;cursor:text;border-radius:2px;padding:1px 3px;display:inline-block;min-width:20px" onmouseover="this.style.borderBottomColor=\'rgba(245,158,11,.5)\'" onmouseout="if(document.activeElement!==this)this.style.borderBottomColor=\'transparent\'" onfocus="this.style.borderBottomColor=\'#f59e0b\'" onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}">'+escHtml(m.rival)+'</span></td>'
      +'<td style="color:#64748b;font-size:11px">'+new Date(m.date).toLocaleDateString('es-ES')+'</td>'
      +porterosCells
      +'<td style="color:'+pctColor+';font-weight:700;text-align:center;white-space:nowrap">'+(totPct!==null?totPct+'%':'—')+gsaxSmall(shots)+'</td>'
      +'<td style="text-align:center">'+ratingSelect(m.fileId,rating,pctColor)+'</td>'
      +'</tr>';
  });

  // ── Global stats cards ───────────────────────────────────────────────
  // ── Ofensiva totals across season ──────────────────────────────────
  var ODEFS=[
    {key:'asistencia',label:'Asistencia',icon:'🤝'},
    {key:'oleada',label:'2ª Oleada Exitosa',icon:'🔄'},
    {key:'contragol',label:'Contragol Exitoso',icon:'⚡'},
    {key:'paseFallado',label:'Pase Fallado',icon:'❌'},
    {key:'gpg',label:'Gol Port. a Port.',icon:'🥅'},
    {key:'gpgFallo',label:'Fallo Port. a Port.',icon:'🚫'},
    {key:'recuperacion',label:'Recuperación',icon:'🛡️'}
  ];
  // Collect all otrasContribs across all matches
  var allOtras=[];
  matchList.forEach(function(m){
    // Build id→name map for this match using corrected portero names
    var pnMap={};
    (m.porteros||[]).forEach(function(p){ pnMap[p.id]=p.name; });
    (m.otrasContribs||[]).forEach(function(e){
      // Normalize name: prefer current portero name by id
      var canonName = _canonPName((e.porteroId&&pnMap[e.porteroId]) ? pnMap[e.porteroId] : (e.porteroName||'—'));
      allOtras.push({key:e.key, porteroName:canonName, id:e.id, time:e.time});
    });
  });

  // Count by portero and key
  function countOtrasByPortero(pname,key,arr){
    return arr.filter(function(e){return e.key===key&&(pname==='all'||e.porteroName===pname);}).length;
  }

  // ── All shots for radar ──────────────────────────────────────────────
  var allShots=[];
  matchList.forEach(function(m){
    var pnMap={};
    (m.porteros||[]).forEach(function(p){ pnMap[p.id]=p.name; });
    (m.shots||[]).forEach(function(s){
      var canonName=_canonPName((s.porteroId&&pnMap[s.porteroId])?pnMap[s.porteroId]:(s.porteroName||'—'));
      allShots.push({zone:s.zone,result:s.result,porteroName:canonName,porteroId:s.porteroId,
                     time:s.time,goalPos:s.goalPos,hab:s.hab||false,noGk:s.noGk||false});
    });
  });

  // ── Zone table (acumulado) ──────────────────────────────────────────────────
  var ZONES_S=['Lateral izq','Central','Lateral der','6m izq','6m cent','6m der','Extremo izq','Extremo der','Contraataque','7 metros'];
  var zoneRows='';
  var td0='padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.04)';
  // Balance = GSAx: paradas esperadas (según la zona de portería de cada tiro) frente a
  // las paradas reales. GSAx = solo la mitad "esperada" de esa cuenta, sin restarle nada.
  function balanceTd(sh){
    var g=calcularGSAx(sh, null);
    if(g.gsax===null) return '<td style="'+td0+';color:#64748b">—</td>';
    var esperadas=Math.round((g.tirosConDato-g.xGOTRecibido)*100)/100;
    return '<td style="'+td0+';color:'+(g.gsax>=0?'#22c55e':'#ef4444')+';font-weight:600" title="Paradas esperadas: '+esperadas+' · Paradas reales: '+g.paradas+'">'+(g.gsax>0?'+':'')+g.gsax+'</td>';
  }
  function gsaxTd(sh){
    var g=calcularGSAx(sh, null);
    if(!g.tirosConDato) return '<td style="'+td0+';color:#64748b">—</td>';
    return '<td style="'+td0+';color:#cbd5e1" title="Sobre '+g.tirosConDato+' tiros a puerta con zona de portería registrada">'+g.xGOTRecibido+'</td>';
  }
  function sGroupRow(label,groupZones,color){
    var sg=allShots.filter(function(s){return groupZones.indexOf(s.zone)>=0;});
    if(!sg.length) return '';
    var pr=sg.filter(function(s){return s.result==='parada';}).length;
    var gl=sg.filter(function(s){return s.result==='gol'||s.result==='sinportero';}).length;
    var fu=sg.filter(function(s){return s.result==='fuera';}).length;
    var lanz=sg.filter(function(s){return s.result!=='fuera'&&s.result!=='sinportero'&&!s.noGk;}).length;
    var pp=lanz>0?Math.round(pr/lanz*1000)/10:null;
    var cc=pp===null?'#64748b':pp>=40?'#6366f1':pp>=35?'#38bdf8':pp>=30?'#16a34a':pp>=25?'#86efac':pp>=20?'#fb923c':'#ef4444';
    var out='<tr data-zone="'+label+'" style="border-top:2px solid rgba(255,255,255,.15);background:rgba(255,255,255,.03);cursor:pointer">'
      +'<td style="'+td0+';color:'+color+';font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px">'+label+'</td>'
      +'<td style="'+td0+';color:#cbd5e1">'+sg.length+'</td>'
      +'<td style="'+td0+';color:#22c55e;font-weight:700">'+pr+'</td>'
      +'<td style="'+td0+';color:#ef4444;font-weight:700">'+gl+'</td>'
      +'<td style="'+td0+';color:#64748b">'+fu+'</td>'
      +'<td style="'+td0+';color:'+cc+';font-weight:700">'+(pp!==null?pp+'%':'—')+'</td>'
      +gsaxTd(sg)+balanceTd(sg)
      +'</tr>';
    groupZones.forEach(function(z){
      var sz=allShots.filter(function(s){return s.zone===z;});
      if(!sz.length) return;
      var pr2=sz.filter(function(s){return s.result==='parada';}).length;
      var gl2=sz.filter(function(s){return s.result==='gol'||s.result==='sinportero';}).length;
      var fu2=sz.filter(function(s){return s.result==='fuera';}).length;
      var lanz2=sz.filter(function(s){return s.result!=='fuera'&&s.result!=='sinportero'&&!s.noGk;}).length;
      var pp2=lanz2>0?Math.round(pr2/lanz2*1000)/10:null;
      var cc2=pp2===null?'#64748b':pp2>=40?'#6366f1':pp2>=35?'#38bdf8':pp2>=30?'#16a34a':pp2>=25?'#86efac':pp2>=20?'#fb923c':'#ef4444';
      out+='<tr data-zone="'+z+'" style="cursor:pointer">'
        +'<td style="'+td0+';color:#94a3b8;font-size:12px;padding-left:18px">'+z+'</td>'
        +'<td style="'+td0+';color:#94a3b8">'+sz.length+'</td>'
        +'<td style="'+td0+';color:#22c55e">'+pr2+'</td>'
        +'<td style="'+td0+';color:#ef4444">'+gl2+'</td>'
        +'<td style="'+td0+';color:#64748b">'+fu2+'</td>'
        +'<td style="'+td0+';color:'+cc2+'">'+(pp2!==null?pp2+'%':'—')+'</td>'
        +gsaxTd(sz)+balanceTd(sz)
        +'</tr>';
    });
    return out;
  }
  zoneRows+=sGroupRow('9m total',['Lateral izq','Central','Lateral der'],'#93c5fd');
  zoneRows+=sGroupRow('6m total',['6m izq','6m cent','6m der'],'#6ee7b7');
  zoneRows+=sGroupRow('Extremos',['Extremo izq','Extremo der'],'#fcd34d');
  ['Contraataque','7 metros'].forEach(function(z){
    var sz=allShots.filter(function(s){return s.zone===z;});
    if(!sz.length) return;
    var pr=sz.filter(function(s){return s.result==='parada';}).length;
    var gl=sz.filter(function(s){return s.result==='gol'||s.result==='sinportero';}).length;
    var fu=sz.filter(function(s){return s.result==='fuera';}).length;
    var lanz=sz.filter(function(s){return s.result!=='fuera'&&s.result!=='sinportero'&&!s.noGk;}).length;
    // A 7 metros, un lanzamiento fuera también cuenta como "éxito" defensivo: se suma a las paradas
    var pp=z==='7 metros'?(sz.length>0?Math.round((pr+fu)/sz.length*1000)/10:null):(lanz>0?Math.round(pr/lanz*1000)/10:null);
    var cc=pp===null?'#64748b':pp>=40?'#6366f1':pp>=35?'#38bdf8':pp>=30?'#16a34a':pp>=25?'#86efac':pp>=20?'#fb923c':'#ef4444';
    zoneRows+='<tr data-zone="'+z+'" style="border-top:2px solid rgba(255,255,255,.15);cursor:pointer">'
      +'<td style="'+td0+';color:#cbd5e1">'+z+'</td>'
      +'<td style="'+td0+';color:#cbd5e1">'+sz.length+'</td>'
      +'<td style="'+td0+';color:#22c55e;font-weight:700">'+pr+'</td>'
      +'<td style="'+td0+';color:#ef4444;font-weight:700">'+gl+'</td>'
      +'<td style="'+td0+';color:#64748b">'+fu+'</td>'
      +'<td style="'+td0+';color:'+cc+';font-weight:700">'+(pp!==null?pp+'%'+(z==='7 metros'?'*':''):'—')+'</td>'
      +gsaxTd(sz)+balanceTd(sz)
      +'</tr>';
  });

  // Build TODOS card + per-portero filter cards
  var todosLanz=0,todosPar=0,todosGol=0;
  globalStats.forEach(function(g){todosLanz+=g.lanz;todosPar+=g.paradas;todosGol+=g.goles;});
  var todosPct=todosLanz>0?Math.round(todosPar/todosLanz*1000)/10:null;
  function makeFilterCard(flt,label,lanz,paradas,goles,pct,partidos,color,active,secs,totalSecs,photo,ox,oy,porteroId,gsax,xg,xgot){
    ox=ox||50;oy=oy||20;porteroId=porteroId||null;
    var pc=pct===null?'#64748b':pct>=40?'#6366f1':pct>=35?'#38bdf8':pct>=30?'#16a34a':pct>=25?'#86efac':pct>=20?'#fb923c':'#ef4444';
    var gsaxRow=(gsax!==null&&gsax!==undefined)
      ?'<div class="pc-gsax-row" style="color:#94a3b8">GSAx</div><div class="pc-gsax-row" style="color:'+(gsax>=0?'#22c55e':'#ef4444')+';font-weight:600">'+(gsax>0?'+':'')+gsax+'</div>'
      :'';
    // GSAx grande junto al % — solo visible en el PDF individual (ver body.pf-on en el CSS de impresión)
    var gsaxBig=(gsax!==null&&gsax!==undefined)
      ?'<div class="pc-gsax-big" style="display:none;color:'+(gsax>=0?'#22c55e':'#ef4444')+'">'+(gsax>0?'+':'')+gsax+'<span style="font-family:DM Sans,sans-serif;font-size:13px;color:#94a3b8;margin-left:8px">GSAx (balance)</span></div>'
      :'';
    var xgRow=(xg!==null&&xg!==undefined)
      ?'<div style="color:#94a3b8" title="Goles esperados a partir de la zona y el tipo de lanzamiento (xG)">xG</div><div style="color:#f8fafc;font-weight:600">'+xg+'</div>'
      :'';
    var xgotRow=(xgot!==null&&xgot!==undefined)
      ?'<div style="color:#94a3b8" title="Goles esperados a partir de la zona de la portería a la que fue cada tiro a puerta (xGOT)">xGOT</div><div style="color:#f8fafc;font-weight:600">'+xgot+'</div>'
      :'';
    return '<div class="pcard" data-filter="'+escHtml(flt)+'" onclick="applySeasonFilter(this.dataset.filter)"'
      +' style="background:'+(active?'#1c2e4a':'#111f3a')+';border:3px solid '+(active?color:'rgba(255,255,255,.06)')+';border-radius:12px;padding:14px;min-width:150px;cursor:pointer;transition:all .2s;user-select:none">'
      +'<div style="font-family:Bebas Neue,sans-serif;font-size:16px;letter-spacing:1px;color:'+color+';margin-bottom:8px">'+escHtml(label)+'</div>'
      +'<div class="pc-toprow" style="display:flex;align-items:center;gap:10px;margin-bottom:4px">'
      +'<div class="pc-pct" style="font-family:Bebas Neue,sans-serif;font-size:48px;line-height:1;color:'+pc+'">'+(pct!==null?pct+'%':'—%')+'</div>'
      +gsaxBig
      +(photo?'<div class="scard-photo" data-pid="'+porteroId+'" style="width:52px;height:52px;border-radius:50%;overflow:hidden;border:2px solid '+color+';flex-shrink:0;cursor:grab;margin-left:auto" title="Arrastra para ajustar"><img src="'+photo+'" style="width:100%;height:100%;object-fit:cover;object-position:'+(ox||50)+'% '+(oy||20)+'%"></div>':'')
      +'</div>'
      +'<div style="font-size:11px;color:#64748b;margin-bottom:4px">efectividad global</div>'
      +'<div class="pc-stats" style="margin-top:12px;font-size:12px;display:grid;grid-template-columns:1fr 1fr;gap:4px">'
      +'<div style="color:#94a3b8">Partidos</div><div style="color:#f8fafc;font-weight:600">'+partidos+'</div>'
      +'<div style="color:#94a3b8">Minutos</div><div style="color:#f8fafc;font-weight:600">'+(secs!=null&&secs>0?(totalSecs>0?Math.round(secs/60)+' ('+Math.round(secs/totalSecs*100)+'%)':Math.round(secs/60)+' min'):'—')+'</div>'
      +'<div style="color:#94a3b8">Lanzamientos</div><div style="color:#f8fafc;font-weight:600">'+lanz+'</div>'
      +'<div style="color:#94a3b8">Paradas</div><div style="color:#22c55e;font-weight:600">'+paradas+'</div>'
      +'<div style="color:#94a3b8">Goles</div><div style="color:#ef4444;font-weight:600">'+goles+'</div>'
      +xgRow
      +xgotRow
      +gsaxRow
      +'</div></div>';
  }
  var totalSecs=0;
  globalStats.forEach(function(g){totalSecs+=(g.seconds||0);});
  var gsInfoTodos=calcularGSAx(allShots, null);
  var gsaxTodos=gsInfoTodos.gsax;
  var xgSeasonInfo=xgTotalEquipo(allShots);
  var seasonRange=(function(){
    var ds=matchList.map(function(m){return new Date(m.date);}).filter(function(d){return !isNaN(d.getTime());}).sort(function(x,y){return x-y;});
    if(!ds.length) return '';
    function f(d){ return d.toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric'}); }
    var a1=f(ds[0]), a2=f(ds[ds.length-1]);
    return ' · '+(a1===a2?a1:a1+' – '+a2);
  })();
  var globalCards=makeFilterCard('TODOS','TODOS',todosLanz,todosPar,todosGol,todosPct,matchList.length,'#f59e0b',true,totalSecs,0,null,null,null,null,gsaxTodos,xgSeasonInfo.conDato?xgSeasonInfo.xg:null,gsInfoTodos.tirosConDato?gsInfoTodos.xGOTRecibido:null);
  globalStats.forEach(function(g,i){
    var shotsG=allShots.filter(function(s){return s.porteroName===g.name;});
    var gsInfoG=calcularGSAx(shotsG, null);
    var gsaxG=gsInfoG.gsax;
    var xgG=xgTotalEquipo(shotsG);
    globalCards+=makeFilterCard(g.name,(g.dorsal?g.dorsal+'. ':'')+g.name,g.lanz,g.paradas,g.goles,g.pct,g.partidos,COLORS[i%COLORS.length],false,g.seconds,totalSecs,g.photo,g.ox,g.oy,g.porteroId,gsaxG,xgG.conDato?xgG.xg:null,gsInfoG.tirosConDato?gsInfoG.xGOTRecibido:null);
  });

  // ── Portero header cols ───────────────────────────────────────────────
  var porteroHeaderCols=porteroNames.map(function(name,i){
    var gsN=globalStats.find(function(x){return x.name===name;});
    return '<th style="color:'+COLORS[i%COLORS.length]+';text-align:center;padding:8px 12px">'+escHtml((gsN&&gsN.dorsal?gsN.dorsal+'. ':'')+name)+'</th>';
  }).join('');

  // ── Chart data ───────────────────────────────────────────────────────
  var totalM = matchList.length;
  var chartLabels=safeJSON(jornadaList.map(function(j,i){
    var num = totalM - i;
    var rival = j.split(' ').slice(1).join(' ');
    return 'J'+num+' '+rival;
  }));
  var chartDatasets=[];
  porteroNames.forEach(function(name,i){
    var color=COLORS[i%COLORS.length];
    var data=jornadaList.map(function(j){
      var e=porteroMap[name].find(function(x){return x.jornada===j;});
      return e&&e.pct!==null?e.pct:null;
    });
    chartDatasets.push({
      type:'bar', label:name, data:data,
      backgroundColor:color.replace('#','')+'33',
      borderColor:color, borderWidth:2, borderRadius:4,
      skipNull:true, order:1
    });
  });
  // % Global line: total paradas / total lanzamientos for that jornada (all porteros combined)
  var mediaData=jornadaList.map(function(j){
    var totLanz=0,totPar=0;
    porteroNames.forEach(function(name){
      var e=porteroMap[name].find(function(x){return x.jornada===j;});
      if(e){totLanz+=e.lanz;totPar+=e.paradas;}
    });
    return totLanz>0?Math.round(totPar/totLanz*1000)/10:null;
  });
  chartDatasets.push({
    type:'line', label:'% Global', data:mediaData,
    borderColor:'#22c55e', backgroundColor:'rgba(34,197,94,.12)',
    borderWidth:3, pointRadius:5,
    pointBackgroundColor:'#22c55e', tension:0.3, skipNull:true, order:0
  });

  // Build mini block with portero filter buttons + counts
  function buildOtrasBlock(filterPortero){
    var mini='';
    ODEFS.forEach(function(d){
      var v=countOtrasByPortero(filterPortero,d.key,allOtras);
      if(v<=0) return;
      mini+='<div style="display:flex;align-items:center;gap:5px;padding:4px 6px;background:rgba(255,255,255,.04);border-radius:5px;min-width:0">'
        +'<span style="font-size:13px;flex-shrink:0">'+d.icon+'</span>'
        +'<div style="flex:1;min-width:0;overflow:hidden"><div style="font-size:9px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+d.label+'</div>'
        +'<div style="font-family:Bebas Neue,sans-serif;font-size:16px;color:#f8fafc;line-height:1">'+v+'</div></div>'
        +'</div>';
    });
    return mini;
  }
  var hasAnyOtras=allOtras.length>0;
  // Build portero filter pills HTML
    var otrasPills='';
  var ofensivaMiniBlock=hasAnyOtras
    ?('<div id="otras-wrap" style="background:#111f3a;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px;flex-shrink:0;width:fit-content;max-width:180px;overflow:hidden;align-self:flex-start">'
      +'<div style="font-family:Bebas Neue,sans-serif;font-size:15px;letter-spacing:1px;color:#f59e0b;margin-bottom:8px">⚡ Otras</div>'
      +'<div id="otras-grid" style="display:grid;grid-template-columns:1fr;gap:4px">'+buildOtrasBlock('all')+'</div>'
      +'</div>')
    :'';


  var html='<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">'
    +'<meta name="viewport" content="width=device-width,initial-scale=1">'
    +'<title>'+escHtml(folderName)+'</title>'
    +'<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">'
    +'<link rel="icon" type="image/png" href="data:image/png;base64,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">'
    +'<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>'
    +'<style>'
    +'*{margin:0;padding:0;box-sizing:border-box}'
    +'body{background:#0a1628;color:#cbd5e1;font-family:"DM Sans",system-ui,sans-serif;min-height:100vh;padding:24px}'
    +'.app{max-width:1300px;margin:0 auto}'
    +'h1{font-family:"Bebas Neue",sans-serif;font-size:clamp(24px,4vw,42px);letter-spacing:3px;color:#f8fafc;margin-bottom:4px}'
    +'.subtitle{color:#64748b;font-size:13px;margin-bottom:24px}'
    +'.section-title{font-family:"Bebas Neue",sans-serif;font-size:22px;letter-spacing:1.5px;color:#f59e0b;margin-bottom:14px}'
    +'.card{background:#111f3a;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:20px;margin-bottom:20px}'
    +'table{width:100%;border-collapse:collapse;font-size:13px}'+'div.scard-photo{cursor:grab}'+'div.scard-photo.dragging{cursor:grabbing}'+'div.scard-photo img{pointer-events:none}'
    +'th{text-align:left;color:#64748b;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.08);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.6px}'
    +'td{padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.04);color:#cbd5e1}'
    +'tr:hover td{background:rgba(255,255,255,.02)}'
    +'tr:last-child td{border-bottom:none}'
    +'#match-table-title{margin-top:32px}'+'select.mrating{background:transparent;border:1px dashed rgba(255,255,255,.18);border-radius:6px;font-size:11px;font-family:inherit;padding:2px 2px;cursor:pointer;max-width:104px;text-align:center}select.mrating option{background:#0f172a;color:#cbd5e1}select.mrating.manual{border-style:solid;border-color:rgba(245,158,11,.6)}'
    +'@media print{@page{size:auto;margin:6mm}select.mrating{border:none!important;background:transparent!important;-webkit-appearance:none!important;appearance:none!important;padding:0!important}#match-table-title~div table th,#match-table-title~div table td,#match-table-title~* table th,#match-table-title~* table td{padding-left:5px!important;padding-right:5px!important}select.mrating{font-size:10px!important;max-width:92px!important}body.pf-on .pcard:not(.pf-sel){display:none!important}body.pf-on #pcards-container{flex-wrap:wrap!important}body.pf-on .pcard.pf-sel{flex:1 1 100%!important;max-width:none!important;min-width:0!important;padding:16px 30px!important}body.pf-on .pf-sel>div:first-child{font-size:26px!important;margin-bottom:6px!important}body.pf-on .pf-sel .pc-toprow{gap:10px 28px!important;margin-bottom:4px!important;flex-wrap:wrap!important}body.pf-on .pf-sel .pc-toprow .scard-photo{order:-1;margin-left:0!important;width:150px!important;height:150px!important;min-width:150px!important;max-width:150px!important;border-width:5px!important}body.pf-on .pf-sel .pc-pct{font-size:76px!important}body.pf-on .pf-sel .pc-gsax-big{display:flex!important;align-items:baseline;font-family:Bebas Neue,sans-serif;font-size:60px;line-height:1}body.pf-on .pf-sel .pc-gsax-row{display:none!important}body.pf-on .pf-sel #otras-wrap{width:auto!important;max-width:none!important;background:transparent!important;border:none!important;border-top:1px solid rgba(255,255,255,.12)!important;border-radius:0!important;padding:10px 0 0!important;margin-top:10px!important;overflow:visible!important}body.pf-on .pf-sel #otras-grid{grid-template-columns:repeat(4,1fr)!important;gap:6px 14px!important}body.pf-on .pf-sel .pc-stats{font-size:14px!important;grid-template-columns:1fr 1fr 1fr 1fr!important;gap:6px 26px!important;margin-top:8px!important}#match-table-title{margin-top:8px!important}#radar-toggles button{display:inline-block!important}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body{padding:0!important;background:#0a1628!important}.app{max-width:none!important}.card{background:#111f3a!important;overflow:hidden!important;margin-bottom:8px!important;padding:12px!important;break-inside:avoid!important;page-break-inside:avoid!important}.card-small{break-inside:avoid!important;page-break-inside:avoid!important}.subtitle{margin-bottom:8px!important}.section-title{color:#f59e0b!important;margin-bottom:8px!important;break-after:avoid!important;page-break-after:avoid!important}.print-chart-wrap{break-inside:avoid!important;page-break-inside:avoid!important}canvas{background:#111f3a!important}#radar-season-canvas{width:100%!important}#chart-scroll-wrap{display:none!important}.pchide{display:none!important;visibility:hidden!important}.print-chart-wrap:not(.pchide){display:block!important;position:static!important;left:auto!important;visibility:visible!important;width:auto!important}.pcard{padding:6px 8px!important;overflow:hidden!important;min-width:0!important;break-inside:avoid!important}.pcard .bn{font-size:32px!important}.scard-photo{width:34px!important;height:34px!important;min-width:34px!important;max-width:34px!important;flex-shrink:0!important;overflow:hidden!important}.pcard-grid{display:flex!important;flex-wrap:wrap!important;gap:4px!important}#otras-wrap{width:auto!important;max-width:none!important;flex-shrink:0!important;padding:8px!important}#otras-grid{grid-template-columns:1fr!important;gap:2px!important}#otras-grid>div{padding:2px 4px!important;white-space:nowrap!important}}'
    +'.print-chart-wrap{position:absolute;left:-9999px;top:0;width:900px;height:320px;overflow:hidden;visibility:hidden}.pchide{display:none!important;visibility:hidden!important}'
    +'#chart-scroll-wrap{scrollbar-width:thin;scrollbar-color:#475569 #0f172a}'
    +'#chart-scroll-wrap::-webkit-scrollbar{height:8px}'
    +'#chart-scroll-wrap::-webkit-scrollbar-track{background:#0f172a;border-radius:4px;margin:0 4px}'
    +'#chart-scroll-wrap::-webkit-scrollbar-thumb{background:linear-gradient(90deg,#334155,#475569);border-radius:4px;border:1px solid rgba(255,255,255,.05)}'
    +'#chart-scroll-wrap::-webkit-scrollbar-thumb:hover{background:linear-gradient(90deg,#475569,#64748b)}'
    +'</style>'
    +'<script type="module">'+FIREBASE_INIT_SRC+'</'+'script>'
    +'</head><body><div class="app">'

    +'<div class="card" style="margin-bottom:20px">'
    +'<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;flex-wrap:wrap">'    +'<div id="season-logo-wrap" style="flex-shrink:0;width:64px;height:64px;border-radius:10px;overflow:hidden;background:rgba(255,255,255,.06);border:2px dashed rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:border-color .2s;position:relative" '    +'title="Clic para añadir logo" onclick="document.getElementById(\'season-logo-input\').click()" '    +'onmouseover="this.style.borderColor=\'rgba(245,158,11,.6)\'" onmouseout="this.style.borderColor=\'rgba(255,255,255,.2)\'">'    +'<img id="season-logo-img" style="display:none;width:100%;height:100%;object-fit:contain" />'    +'<span id="season-logo-placeholder" style="font-size:22px;color:rgba(255,255,255,.3)">🖼</span>'    +'</div>'    +'<input type="file" id="season-logo-input" accept="image/*" style="display:none" onchange="var f=this.files[0];if(!f)return;var r=new FileReader();r.onload=function(e){var img=document.getElementById(\'season-logo-img\');img.src=e.target.result;img.style.display=\'block\';document.getElementById(\'season-logo-placeholder\').style.display=\'none\';document.getElementById(\'season-logo-wrap\').style.border=\'2px solid rgba(255,255,255,.15)\';try{var cfg=JSON.parse(localStorage.getItem(\'hb_season_cfg_\'+FOLDER_ID)||\'{}\')||{};cfg.logo=e.target.result;localStorage.setItem(\'hb_season_cfg_\'+FOLDER_ID,JSON.stringify(cfg));typeof _uploadPhoto===\'function\'&&_uploadPhoto(\'temporada\',FOLDER_ID,e.target.result);}catch(ex){}};r.readAsDataURL(f)" />'    +'<div style="flex:1"><h1 id="season-report-title" contenteditable="true" spellcheck="false" style="outline:none;cursor:text;border-bottom:2px solid transparent;transition:border-color .2s" onmouseover="this.style.borderBottomColor=&apos;rgba(245,158,11,.4)&apos;" onmouseout="this.style.borderBottomColor=&apos;transparent&apos;" onfocus="this.style.borderBottomColor=&apos;#f59e0b&apos;" onblur="this.style.borderBottomColor=&apos;transparent&apos;;try{var cfg=JSON.parse(localStorage.getItem(&apos;hb_season_cfg_&apos;+FOLDER_ID)||&apos;{}&apos;);cfg.title=this.textContent.trim();localStorage.setItem(&apos;hb_season_cfg_&apos;+FOLDER_ID,JSON.stringify(cfg));}catch(e){}">'+escHtml(folderName)+'</h1>'
    +'<div class="subtitle">'+files.length+' partidos registrados'+seasonRange+'</div></div>'
    +'<div style="margin-left:auto;display:flex;gap:8px"><button onclick="window.print()" style="background:linear-gradient(135deg,#1a56db,#2563eb);color:#fff;border:none;border-radius:8px;padding:8px 16px;cursor:pointer;font-size:13px;font-weight:600">📥 Exportar PDF</button><button onclick="hkCloseSeason()" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#94a3b8;border-radius:8px;padding:8px 16px;cursor:pointer;font-family:DM Sans,sans-serif;font-size:13px">✕ Cerrar</button></div>'
    +'</div>'
    +'<div class="section-title">🧤 Rendimiento Global</div>'
    +'<div style="display:flex;gap:16px;flex-wrap:nowrap;align-items:flex-start;margin-bottom:24px" id=pcards-container>'+globalCards+ofensivaMiniBlock+'</div>'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'
    +'<div class="section-title" style="margin:0">📈 Evolución jornada a jornada</div>'
    +'<div style="display:flex;gap:8px"><button id="btn-chart-order" onclick="toggleChartOrder()" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#94a3b8;border-radius:8px;padding:7px 16px;cursor:pointer;font-family:DM Sans,sans-serif;font-size:13px;font-weight:600">⏭ Cronológico</button>'
    +'<button onclick="openRivales()" style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;border:none;border-radius:8px;padding:7px 16px;cursor:pointer;font-family:DM Sans,sans-serif;font-size:13px;font-weight:600">⚔️ Rivales</button></div></div>'
    +'<div id="chart-scroll-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch"><div class="chart-inner" style="position:relative;height:420px;min-width:'+Math.max(600, matchList.length*80)+'px"><canvas id="seasonChart"></canvas></div></div>'
    +'<div class="print-chart-wrap" style="margin-bottom:10px"><div id="print-legend" style="display:flex;flex-wrap:wrap;gap:8px 16px;margin-bottom:10px"></div><canvas id="printChart1" style="display:block;width:100%"></canvas></div>'
    +'<div class="print-chart-wrap" style="margin-bottom:20px"><canvas id="printChart2" style="display:block;width:100%"></canvas></div>'
    +'<div class="section-title" style="margin-bottom:12px;margin-top:0" id="match-table-title">📋 Partido a partido</div>'
    +'<div style="overflow-x:auto"><table>'
    +'<thead><tr>'
    +'<th>J</th><th>Rival</th><th>Fecha</th>'
    +porteroHeaderCols
    +'<th style="text-align:center">TOTAL</th><th style="text-align:center">Valoración</th>'
    +'</tr></thead>'
    +'<tbody>'+matchRows+'</tbody>'    +'</table></div>'
    +'</div>'
    
        +'<div class="card card-small">'    +'<div class="section-title" style="margin-bottom:12px">📡 Radar por zona (temporada completa)</div>'    +'<div id="radar-toggles" style="display:flex;gap:8px;flex-wrap:wrap;flex:1"></div><button id="hab-season-btn" onclick="toggleSeasonHab(this)" style="padding:6px 14px;border-radius:20px;cursor:pointer;font-size:12px;font-weight:600;font-family:DM Sans,sans-serif;border:2px solid rgba(168,85,247,.3);background:transparent;color:rgba(168,85,247,.5)">&#10024; HAB</button></div>'    +'<canvas id="radar-season-canvas" width="700" height="620" style="max-width:100%;display:block;margin:0 auto"></canvas>'    +'<div style="font-size:10px;color:#64748b;margin-top:6px">* Desde los 7M contaremos para este porcentaje todos los lanzamientos en los que haya tenido éxito la portería, también los que van fuera, sin que estos últimos sumen al porcentaje global de paradas.</div>'    +'</div>'    +'<div class="card card-small">'    +'<div class="section-title" style="margin-bottom:12px">🗺️ Por zona de campo (acumulado)</div>'    +'<table class="zone-season-table">'    +'<thead><tr>'    +'<th style="text-align:left;color:#64748b;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.08);font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Zona</th>'    +'<th style="text-align:center;color:#64748b;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.08);font-weight:500;font-size:10px;text-transform:uppercase">Lanz.</th>'    +'<th style="text-align:center;color:#22c55e;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.08);font-weight:500;font-size:10px;text-transform:uppercase">Paradas</th>'    +'<th style="text-align:center;color:#ef4444;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.08);font-weight:500;font-size:10px;text-transform:uppercase">Goles</th>'    +'<th style="text-align:center;color:#64748b;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.08);font-weight:500;font-size:10px;text-transform:uppercase">Fuera</th>'    +'<th style="text-align:center;color:#f59e0b;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.08);font-weight:500;font-size:10px;text-transform:uppercase">% Par.*</th>'    +'<th style="text-align:center;color:#64748b;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.08);font-weight:500;font-size:10px;text-transform:uppercase" title="Goles esperados totales, según la zona de portería a la que fue cada tiro y el tipo de lanzamiento">xGOT</th>'    +'<th style="text-align:center;color:#64748b;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.08);font-weight:500;font-size:10px;text-transform:uppercase" title="Balance (GSAx): paradas reales frente a las esperadas según xGOT. Positivo = paró más de lo esperado">Balance</th>'    +'</tr></thead>'    +'<tbody>'+zoneRows+'</tbody>'    +'</table>'    +'<div style="font-size:10px;color:#64748b;margin-top:4px">* Desde los 7M contaremos para este porcentaje todos los lanzamientos en los que haya tenido éxito la portería, también los que van fuera, sin que estos últimos sumen al porcentaje global de paradas.</div>'    +'</div>'
    
    +'<div class="card card-small">'    +'<div class="section-title" style="margin-bottom:12px">🥅 Portería (acumulado)</div>'
    +'<svg id="goal-season-svg" viewBox="0 0 468 269" style="width:100%;max-width:560px;display:block;margin:0 auto">'
    +'<defs><pattern id="netS" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="20" y2="20" stroke="rgba(255,255,255,.09)" stroke-width=".9"/><line x1="20" y1="0" x2="0" y2="20" stroke="rgba(255,255,255,.09)" stroke-width=".9"/></pattern>'
    +'<pattern id="hPostS" x="0" y="0" width="100" height="16" patternUnits="userSpaceOnUse"><rect width="100" height="8" fill="#dc2626"/><rect y="8" width="100" height="8" fill="#efefef"/></pattern>'
    +'<pattern id="hBarS" x="0" y="0" width="20" height="100" patternUnits="userSpaceOnUse"><rect width="10" height="100" fill="#dc2626"/><rect x="10" width="10" height="100" fill="#efefef"/></pattern>'
    +'</defs>'
    +'<rect width="468" height="269" fill="#091524" rx="8"/>'
    +'<rect x="54" y="44" width="360" height="200" fill="url(#netS)"/>'
    +'<rect x="44" y="36" width="380" height="205" rx="5" fill="none" stroke="rgba(0,0,0,.75)" stroke-width="16"/>'
    +'<rect x="48" y="40" width="372" height="196" rx="3" fill="none" stroke="white" stroke-width="5"/>'
    +'<rect x="36" y="36" width="22" height="205" fill="url(#hPostS)" rx="3"/>'
    +'<rect x="410" y="36" width="22" height="205" fill="url(#hPostS)" rx="3"/>'
    +'<rect x="36" y="36" width="396" height="16" fill="url(#hBarS)" rx="3"/>'
    +'<line x1="174" y1="52" x2="174" y2="232" stroke="rgba(255,255,255,.3)" stroke-width="1.5"/>'
    +'<line x1="294" y1="52" x2="294" y2="232" stroke="rgba(255,255,255,.3)" stroke-width="1.5"/>'
    +'<line x1="58" y1="119" x2="410" y2="119" stroke="rgba(255,255,255,.3)" stroke-width="1.5"/>'
    +'<line x1="58" y1="186" x2="410" y2="186" stroke="rgba(255,255,255,.3)" stroke-width="1.5"/>'
    +'<g id="goal-season-cells"></g>'
    +'</svg>'    +'</div>'
    +'</div>'    +'<script>'
    +'var ctx=document.getElementById("seasonChart").getContext("2d");'
    +'var seasonChart=new Chart(ctx,{'
    +'  type:"bar",'
    +'  data:{labels:'+chartLabels+',datasets:'+JSON.stringify(chartDatasets)+'},'
    +'  options:{'
    +'    responsive:true,maintainAspectRatio:false,'
    +'    plugins:{'
    +'      legend:{labels:{color:"rgba(255,255,255,.7)",font:{family:"DM Sans",size:12},generateLabels:function(chart){return chart.data.datasets.map(function(ds,i){var isLine=ds.type===\"line\";return {text:ds.label,fillStyle:isLine?\"transparent\":ds.borderColor,strokeStyle:ds.borderColor,lineWidth:isLine?3:1,pointStyle:isLine?\"line\":\"rect\",fontColor:\"rgba(255,255,255,.85)\",hidden:false,datasetIndex:i};});}}},'
    +'      tooltip:{callbacks:{label:function(c){return c.dataset.label+": "+(c.raw!==null?c.raw+"%":"—");}}},'
    +'      annotation:{}'
    +'    },'
    +'    scales:{'
    +'      x:{ticks:{color:"rgba(255,255,255,.5)",maxRotation:75,minRotation:60,padding:6},grid:{color:"rgba(255,255,255,.05)"}},'
    +'      y:{min:0,max:70,beginAtZero:true,grace:0,suggestedMin:0,ticks:{color:"rgba(255,255,255,.5)",callback:function(v){return v+"%";}},grid:{color:"rgba(255,255,255,.05)"},'
    +'         title:{display:true,text:"% Efectividad",color:"rgba(255,255,255,.4)"}}'
    +'    }'
    +'  }'
    +'});'
    +'seasonChart._updateRival=function(idx,name){if(seasonChart.data.labels[idx]!==undefined){seasonChart.data.labels[idx]=name;seasonChart.update("none");}};'
    +'function _saveCfg(key,val){try{var cfg=JSON.parse(localStorage.getItem("hb_season_cfg_"+FOLDER_ID)||"{}");cfg[key]=val;localStorage.setItem("hb_season_cfg_"+FOLDER_ID,JSON.stringify(cfg));}catch(e){}}'
    +'function toggleChartOrder(){'
      +'seasonChart.data.labels.reverse();'
      +'seasonChart.data.datasets.forEach(function(ds){ds.data.reverse();});'
      +'seasonChart.update();'
      +'seasonChart._chronological=!seasonChart._chronological;'
      +'var btn=document.getElementById("btn-chart-order");'
      +'if(btn)btn.textContent=seasonChart._chronological?"⏮ Más reciente primero":"⏭ Cronológico";'
      +'_saveCfg("chartChronological",seasonChart._chronological);'
    +'}'
    +'try{var _cfg0=JSON.parse(localStorage.getItem("hb_season_cfg_"+FOLDER_ID)||"{}");if(_cfg0.chartChronological){toggleChartOrder();}}catch(e){}'
    +'function _rebuildLabel(idx){var jEl=document.querySelector("[data-jidx=\\""+idx+"\\"]");var rEl=document.querySelector("[data-idx=\\""+idx+"\\"]");var j=jEl?jEl.innerText.trim():"";var r=rEl?rEl.innerText.trim():"";var lbl=(j&&r)?j+" "+r:(r||j);if(seasonChart&&seasonChart.data.labels[idx]!==undefined){seasonChart.data.labels[idx]=lbl;seasonChart.update("none");}}'
    +'function updateRival(el){var idx=parseInt(el.getAttribute("data-idx"));var name=el.innerText.trim();if(!isNaN(idx)){_rebuildLabel(idx);_saveCfg("rival_"+idx,name);}el.style.borderBottomColor="transparent";}'
    +'var RATING_COLORS={"EXCEPCIONAL":"#6366f1","MUY BUENA":"#38bdf8","BUENA":"#16a34a","CORRECTA":"#86efac","MEJORABLE":"#fb923c","MALA":"#ef4444"};'
    +'function ratingStore(){try{return JSON.parse(localStorage.getItem("hb_season_ratings_"+FOLDER_ID)||"{}")||{};}catch(e){return {};}}'
    +'function paintRating(s){var manual=!!s.value;s.style.color=manual?(RATING_COLORS[s.value]||"#cbd5e1"):(s.dataset.color||"#94a3b8");s.classList.toggle("manual",manual);}'
    +'function initRatings(){var st=ratingStore();document.querySelectorAll("select.mrating").forEach(function(s){if(st[s.dataset.fid])s.value=st[s.dataset.fid];paintRating(s);});}'
    +'function setMatchRating(s){if(s.value==="__auto")s.value="";var st=ratingStore();if(s.value)st[s.dataset.fid]=s.value;else delete st[s.dataset.fid];try{localStorage.setItem("hb_season_ratings_"+FOLDER_ID,JSON.stringify(st));}catch(e){}paintRating(s);}'
    +'function saveJornada(el){var idx=parseInt(el.getAttribute("data-jidx"));var val=el.innerText.trim();if(!isNaN(idx)){_rebuildLabel(idx);_saveCfg("jornada_"+idx,val);}el.style.borderBottomColor="transparent";}'
    +'</'+'script>'    +'<script>'    +'var ALL_SHOTS='+safeJSON(allShots)+';'
    +'var ALL_OTRAS='+safeJSON(allOtras)+';'
    +'var ODEFS_DATA='+safeJSON(ODEFS)+';'
    +'var CHART_DS='+safeJSON(chartDatasets)+';'
    +'var PORTERO_NAMES='+safeJSON(porteroNames)+';'
    +'var ALL_MATCHES='+safeJSON(matchList.map(function(m){return {rival:m.rival,date:m.date,fileId:m.fileId,shots:m.shots.map(function(s){var pnMap={};(m.porteros||[]).forEach(function(p){pnMap[p.id]=p.name;});return {zone:s.zone,result:s.result,goalPos:s.goalPos,porteroName:_canonPName((s.porteroId&&pnMap[s.porteroId])?pnMap[s.porteroId]:(s.porteroName||null)),attacker:s.attacker||null,pf:s.pf||false,pd:s.pd||false,hab:s.hab||false,noGk:s.noGk||false};}),porteros:m.porteros};}))+';'
    +'var FOLDER_ID='+JSON.stringify(folderId)+';'
    +'var SEASON_JUMP_TO='+safeJSON(jumpTo||null)+';'
    +XG_MODEL_SRC
    +PHOTO_SYNC_SRC
    +'var curSeasonFilter="TODOS";'    +'var radarSeason={gol:true,parada:true,pct:true};'    +'function buildToggles(){var tb=document.getElementById("radar-toggles");tb.innerHTML="";[{k:"gol",l:"Nº Goles",c:"#ef4444"},{k:"parada",l:"Nº Paradas",c:"#22c55e"},{k:"pct",l:"% Eficiencia",c:"#3b82f6"}].forEach(function(d){var b=document.createElement("button");function sty(on){return "padding:6px 14px;border-radius:20px;cursor:pointer;font-size:12px;font-weight:600;font-family:DM Sans,sans-serif;border:2px solid "+(on?d.c:"rgba(255,255,255,.15)")+";background:"+(on?"rgba(255,255,255,.08)":"transparent")+";color:"+(on?d.c:"rgba(255,255,255,.3)")+";"}b.style.cssText=sty(radarSeason[d.k]);b.textContent=d.l;b.onclick=function(){radarSeason[d.k]=!radarSeason[d.k];b.style.cssText=sty(radarSeason[d.k]);var fS2=curSeasonFilter==="TODOS"?ALL_SHOTS:ALL_SHOTS.filter(function(s){return s.porteroName===curSeasonFilter;});drawSeasonRadar(fS2);drawSeasonGoal(fS2);};tb.appendChild(b);});}'    +'function drawSeasonRadar(shotsData){var cv=document.getElementById("radar-season-canvas");if(!cv)return;var ctx=cv.getContext("2d"),W=cv.width,H=cv.height;ctx.clearRect(0,0,W,H);var LEG=6,PAD=8,CROP_Y=315;var scaleX=(W-PAD*2)/420,scaleY=(H-PAD*2-LEG)/CROP_Y;function sx(x){return PAD+x*scaleX;}function sy(y){return PAD+y*scaleY;}ctx.fillStyle="#5b9bd5";ctx.fillRect(0,0,W,H-LEG);ctx.strokeStyle="rgba(255,255,255,.85)";ctx.lineWidth=2.5;ctx.strokeRect(sx(5),sy(5),sx(415)-sx(5),sy(CROP_Y-5)-sy(0));ctx.beginPath();ctx.moveTo(sx(69),sy(5));ctx.bezierCurveTo(sx(69),sy(97),sx(351),sy(97),sx(351),sy(5));ctx.closePath();ctx.fillStyle="#1a4a8a";ctx.fill();ctx.strokeStyle="rgba(255,255,255,.92)";ctx.lineWidth=2.5;ctx.stroke();ctx.beginPath();ctx.moveTo(sx(5),sy(5));ctx.bezierCurveTo(sx(5),sy(158),sx(415),sy(158),sx(415),sy(5));ctx.setLineDash([10*scaleX,6*scaleX]);ctx.strokeStyle="rgba(255,255,255,.7)";ctx.lineWidth=2;ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(sx(210),sy(118),4,0,2*Math.PI);ctx.fillStyle="rgba(255,255,255,.85)";ctx.fill();ctx.beginPath();ctx.moveTo(sx(196),sy(118));ctx.lineTo(sx(224),sy(118));ctx.strokeStyle="rgba(255,255,255,.5)";ctx.lineWidth=1.5;ctx.stroke();ctx.save();ctx.beginPath();ctx.rect(sx(163),sy(0),sx(257)-sx(163),sy(22)-sy(0));ctx.clip();ctx.strokeStyle="rgba(255,255,255,.22)";ctx.lineWidth=0.7;for(var gx=150;gx<=270;gx+=10){ctx.beginPath();ctx.moveTo(sx(gx),sy(0));ctx.lineTo(sx(gx+14),sy(22));ctx.stroke();ctx.beginPath();ctx.moveTo(sx(gx),sy(0));ctx.lineTo(sx(gx-14),sy(22));ctx.stroke();}ctx.restore();var barX=sx(159),barW=sx(261)-sx(159),barH=Math.max(7,sy(8)-sy(0));for(var si=0;si<10;si++){ctx.fillStyle=si%2===0?"#dc2626":"#f0f0f0";ctx.fillRect(barX+si/10*barW,sy(0),barW/10+0.5,barH);}var postW=Math.max(7,sx(164)-sx(156)),postH=sy(24)-sy(0);for(var pi=0;pi<5;pi++){ctx.fillStyle=pi%2===0?"#dc2626":"#f0f0f0";ctx.fillRect(sx(156),sy(0)+pi/5*postH,postW,postH/5+0.5);ctx.fillRect(sx(256),sy(0)+pi/5*postH,postW,postH/5+0.5);}var ZC={"Extremo izq":[sx(5+18),sy(22)],"Extremo der":[sx(420-23),sy(22)],"6m izq":[sx(69+38),sy(80)],"6m cent":[sx(147+63),sy(80)],"6m der":[sx(275+38),sy(80)],"Lateral izq":[sx(5+54),sy(140)],"Central":[sx(143+67),sy(140)],"Lateral der":[sx(307+54),sy(140)],"7 metros":[sx(70+64),sy(240)],"Contraataque":[sx(221+64),sy(240)]};var ZL={"Extremo izq":"EI","Extremo der":"ED","6m izq":"6mI","6m cent":"6mC","6m der":"6mD","Lateral izq":"LI","Central":"CE","Lateral der":"LD","7 metros":"7M","Contraataque":"CTQ"};var zones=Object.keys(ZC),totalLanz=0,zSt={};zones.forEach(function(z){var sz=shotsData.filter(function(s){return s.zone===z;});var gol=sz.filter(function(s){return s.result==="gol"||s.result==="sinportero";}).length;var par=sz.filter(function(s){return s.result==="parada";}).length;var fu=sz.filter(function(s){return s.result==="fuera";}).length;var lanz=sz.filter(function(s){return s.result!=="fuera"&&!s.noGk;}).length;var is7m=z==="7 metros",pctDen=is7m?sz.length:lanz,pctNum=is7m?(par+fu):par;var bal=calcularGSAx(sz,null).gsax;zSt[z]={gol:gol,par:par,lanz:lanz,pct:pctDen>0?pctNum/pctDen:0,pctOk:pctDen>0,pctNum:pctNum,pctDen:pctDen,balance:bal};totalLanz+=lanz;});var RMAX=Math.min(W,H-LEG)*0.13,RMIN=6;zones.forEach(function(z){var s=zSt[z];if(s.lanz===0)return;var cx=ZC[z][0],cy=ZC[z][1];var rGol=totalLanz>0?Math.min(RMAX,RMIN+(s.gol/totalLanz)*(RMAX-RMIN)*3.5):0;var rPar=totalLanz>0?Math.min(RMAX,RMIN+(s.par/totalLanz)*(RMAX-RMIN)*3.5):0;var rPct=Math.min(RMAX,RMIN+s.pct*(RMAX-RMIN));var circles=[{r:rGol,color:"#ef4444",fill:"rgba(239,68,68,.85)",key:"gol",val:s.gol,label:s.gol>0?""+s.gol:null},{r:rPar,color:"#22c55e",fill:"rgba(34,197,94,.85)",key:"parada",val:s.par,label:s.par>0?""+s.par:null},{r:rPct,color:"#3b82f6",fill:"rgba(59,130,246,.85)",key:"pct",val:s.pct,label:s.pctOk?Math.round(s.pct*100)+"%":null}].filter(function(c){return radarSeason[c.key]&&c.r>=RMIN&&(c.key==="pct"?s.pctOk:c.val>0);}).sort(function(a,b){return b.r-a.r;});circles.forEach(function(c){ctx.save();ctx.beginPath();ctx.arc(cx,cy,c.r,0,2*Math.PI);ctx.fillStyle=c.fill;ctx.fill();ctx.strokeStyle=c.color;ctx.lineWidth=2;ctx.stroke();ctx.restore();});if(s.pctOk){var lf1=24,lf2=15,lf3=15;var lh1=lf1*1.05,lh2=lf2*1.15,lh3=lf3*1.15;var lTop=cy-(lh1+lh2+lh3)/2;var yPct=lTop+lh1/2,yFrac=lTop+lh1+lh2/2,yBal=lTop+lh1+lh2+lh3/2;var pctTxt=Math.round(s.pct*100)+"%";ctx.save();ctx.textAlign="center";ctx.textBaseline="middle";ctx.shadowColor="rgba(0,0,0,.85)";ctx.shadowBlur=4;ctx.font="bold "+lf1+"px DM Sans,sans-serif";ctx.fillStyle="#ffffff";ctx.fillText(pctTxt,cx,yPct);if(z==="7 metros"){var lw2=ctx.measureText(pctTxt).width;ctx.font="bold "+Math.round(lf1*0.65)+"px DM Sans,sans-serif";ctx.fillStyle="#94a3b8";ctx.textAlign="left";ctx.fillText("*",cx+lw2/2+1,yPct-lf1*0.28);ctx.textAlign="center";}ctx.font="700 "+lf2+"px DM Sans,sans-serif";ctx.fillStyle="rgba(255,255,255,.88)";ctx.fillText(s.pctNum+"/"+s.pctDen,cx,yFrac);ctx.font="700 "+lf3+"px DM Sans,sans-serif";ctx.fillStyle=(s.balance===null)?"rgba(255,255,255,.55)":(s.balance>=0?"#4ade80":"#f87171");ctx.fillText(s.balance===null?"—":(s.balance>0?"+":"")+s.balance,cx,yBal);ctx.restore();}if(z==="7 metros"||z==="Contraataque"){ctx.save();ctx.font="bold 14px DM Sans,sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";var lbl=ZL[z];var ly=cy+RMAX-9;var tw=ctx.measureText(lbl).width,bw=tw+12,bh=20,bx=cx-bw/2,by=ly-bh/2,br=5;ctx.beginPath();ctx.moveTo(bx+br,by);ctx.lineTo(bx+bw-br,by);ctx.arcTo(bx+bw,by,bx+bw,by+br,br);ctx.lineTo(bx+bw,by+bh-br);ctx.arcTo(bx+bw,by+bh,bx+bw-br,by+bh,br);ctx.lineTo(bx+br,by+bh);ctx.arcTo(bx,by+bh,bx,by+bh-br,br);ctx.lineTo(bx,by+br);ctx.arcTo(bx,by,bx+br,by,br);ctx.closePath();ctx.fillStyle="rgba(30,34,42,.72)";ctx.fill();ctx.fillStyle="#ffffff";ctx.fillText(lbl,cx,ly);ctx.restore();}});}'      +'var _dsgB="ZnVuY3Rpb24gZHJhd1NlYXNvbkdvYWwoc2hvdHMpewogIHZhciBnYz1kb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZ29hbC1zZWFzb24tY2VsbHMnKTsKICBpZighZ2MpcmV0dXJuOwogIGdjLmlubmVySFRNTD0nJzsKICB2YXIgY2VsbHM9WwogICAge3BvczonQWx0byBpenEnLHg6NTgseTo1Mix3OjExNCxoOjY1fSx7cG9zOidBbHRvIGNlbnRybycseDoxNzYseTo1Mix3OjExNixoOjY1fSx7cG9zOidBbHRvIGRlcicseDoyOTYseTo1Mix3OjExNCxoOjY1fSwKICAgIHtwb3M6J01lZGlvIGl6cScseDo1OCx5OjEyMSx3OjExNCxoOjYzfSx7cG9zOidDZW50cm8nLHg6MTc2LHk6MTIxLHc6MTE2LGg6NjN9LHtwb3M6J01lZGlvIGRlcicseDoyOTYseToxMjEsdzoxMTQsaDo2M30sCiAgICB7cG9zOidCYWpvIGl6cScseDo1OCx5OjE4OCx3OjExNCxoOjU4fSx7cG9zOidCYWpvIGNlbnRybycseDoxNzYseToxODgsdzoxMTYsaDo1OH0se3BvczonQmFqbyBkZXInLHg6Mjk2LHk6MTg4LHc6MTE0LGg6NTh9CiAgXTsKICB2YXIgY2VsbHNGdWVyYT1bCiAgICB7cG9zOidGdWVyYSBhbHRvIGl6cScseDoxMix5OjUyLHc6MjQsaDo2NX0se3BvczonRnVlcmEgbWVkaW8gaXpxJyx4OjEyLHk6MTIxLHc6MjQsaDo2M30se3BvczonRnVlcmEgYmFqbyBpenEnLHg6MTIseToxODgsdzoyNCxoOjU4fSwKICAgIHtwb3M6J0Z1ZXJhIGFsdG8gZGVyJyx4OjQzMix5OjUyLHc6MjQsaDo2NX0se3BvczonRnVlcmEgbWVkaW8gZGVyJyx4OjQzMix5OjEyMSx3OjI0LGg6NjN9LHtwb3M6J0Z1ZXJhIGJham8gZGVyJyx4OjQzMix5OjE4OCx3OjI0LGg6NTh9LAogICAge3BvczonRnVlcmEgYXJyaWJhIGl6cScseDo1OCx5OjEyLHc6MTE0LGg6MjR9LHtwb3M6J0Z1ZXJhIGFycmliYSBjZW50cm8nLHg6MTc2LHk6MTIsdzoxMTYsaDoyNH0se3BvczonRnVlcmEgYXJyaWJhIGRlcicseDoyOTYseToxMix3OjExNCxoOjI0fQogIF07CiAgdmFyIGdzYXhaPWdzYXhQb3Jab25hKHNob3RzLCBudWxsKS5wb3Jab25hOwogIGNlbGxzLmZvckVhY2goZnVuY3Rpb24oYyl7CiAgICB2YXIgc3o9c2hvdHMuZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLmdvYWxQb3M9PT1jLnBvczt9KTsKICAgIHZhciBwcj1zei5maWx0ZXIoZnVuY3Rpb24ocyl7cmV0dXJuIHMucmVzdWx0PT09J3BhcmFkYSc7fSkubGVuZ3RoOwogICAgdmFyIGx6PXN6LmZpbHRlcihmdW5jdGlvbihzKXtyZXR1cm4gcy5yZXN1bHQhPT0nZnVlcmEnJiYhcy5ub0drO30pLmxlbmd0aDsKICAgIHZhciBwcD1sej4wP01hdGgucm91bmQocHIvbHoqMTAwKTpudWxsOwogICAgdmFyIHRjPXBwPT09bnVsbD8nIzY0NzQ4Yic6cHA+PTQwPycjNjM2NmYxJzpwcD49MzU/JyMzOGJkZjgnOnBwPj0zMD8nIzE2YTM0YSc6cHA+PTI1PycjODZlZmFjJzpwcD49MjA/JyNmYjkyM2MnOicjZWY0NDQ0JzsKICAgIHZhciBmaWxsPXBwPT09bnVsbD8ncmdiYSgyNTUsMjU1LDI1NSwuMDQpJzoodGMrJzMzJyk7CiAgICB2YXIgaD0nPHJlY3QgeD0iJytjLngrJyIgeT0iJytjLnkrJyIgd2lkdGg9IicrYy53KyciIGhlaWdodD0iJytjLmgrJyIgZmlsbD0iJytmaWxsKyciIHJ4PSIzIi8+JzsKICAgIGlmKGx6PjApewogICAgICBoKz0nPHRleHQgeD0iJysoYy54K2Mudy8yKSsnIiB5PSInKyhjLnkrYy5oLzItOSkrJyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iJyt0YysnIiBmb250LXNpemU9IjE0IiBmb250LXdlaWdodD0iNzAwIj4nK3ByKycvJytseisnPC90ZXh0Pic7CiAgICAgIGgrPSc8dGV4dCB4PSInKyhjLngrYy53LzIpKyciIHk9IicrKGMueStjLmgvMis2KSsnIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSInK3RjKyciIGZvbnQtc2l6ZT0iMTEiPicrKHBwIT09bnVsbD9wcCsnJSc6Jy0tJykrJzwvdGV4dD4nOwogICAgICB2YXIgemQ9Z3NheFpbYy5wb3NdOwogICAgICBpZih6ZCAmJiB6ZC50aXJvcz4wKXsKICAgICAgICB2YXIgZGM9emQuZGlmZXJlbmNpYT49MD8nIzIyYzU1ZSc6JyNlZjQ0NDQnOwogICAgICAgIGgrPSc8dGV4dCB4PSInKyhjLngrYy53LzIpKyciIHk9IicrKGMueStjLmgvMisxNykrJyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iJytkYysnIiBmb250LXNpemU9IjkiIGZvbnQtd2VpZ2h0PSI2MDAiPkdTQXggJysoemQuZGlmZXJlbmNpYT4wPycrJzonJykremQuZGlmZXJlbmNpYSsnPC90ZXh0Pic7CiAgICAgIH0KICAgIH0KICAgIGdjLmlubmVySFRNTCs9aDsKICB9KTsKICBjZWxsc0Z1ZXJhLmZvckVhY2goZnVuY3Rpb24oYyl7CiAgICB2YXIgbj1zaG90cy5maWx0ZXIoZnVuY3Rpb24ocyl7cmV0dXJuIHMuZ29hbFBvcz09PWMucG9zO30pLmxlbmd0aDsKICAgIHZhciBoPSc8cmVjdCB4PSInK2MueCsnIiB5PSInK2MueSsnIiB3aWR0aD0iJytjLncrJyIgaGVpZ2h0PSInK2MuaCsnIiBmaWxsPSJyZ2JhKDIzOSw2OCw2OCwuMTApIiBzdHJva2U9InJnYmEoMjM5LDY4LDY4LC4zNSkiIHN0cm9rZS13aWR0aD0iMSIgc3Ryb2tlLWRhc2hhcnJheT0iMyAyIiByeD0iMyIvPic7CiAgICBpZihuPjApewogICAgICBoKz0nPHRleHQgeD0iJysoYy54K2Mudy8yKSsnIiB5PSInKyhjLnkrYy5oLzIrNCkrJyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI2Y4NzE3MSIgZm9udC1zaXplPSIxMiIgZm9udC13ZWlnaHQ9IjcwMCI+JytuKyc8L3RleHQ+JzsKICAgIH0KICAgIGdjLmlubmVySFRNTCs9aDsKICB9KTsKfQ==";eval(decodeURIComponent(escape(atob(_dsgB))));'
    +'var seasonZoneFilter=null;'
+'var _SGMAP={"9m total":["Lateral izq","Central","Lateral der"],"6m total":["6m izq","6m cent","6m der"],"Extremos":["Extremo izq","Extremo der"]};'
+'document.addEventListener("click",function(e){var tr=e.target.closest(".zone-season-table tr[data-zone]");if(tr)setSeasonZoneFilter(tr.dataset.zone,tr);});'
+'function setSeasonZoneFilter(zone,el){'
+'  if(seasonZoneFilter===zone){seasonZoneFilter=null;}else{seasonZoneFilter=zone;}'
+'  document.querySelectorAll(".zone-season-table tr[data-zone]").forEach(function(r){'
+'    r.style.background=(seasonZoneFilter&&r.dataset.zone===zone)?"rgba(99,102,241,.18)":"";'
+'    r.style.outline=(seasonZoneFilter&&r.dataset.zone===zone)?"1px solid rgba(99,102,241,.5)":"";'
+'  });'
+'   var fS=curSeasonFilter==="TODOS"?ALL_SHOTS:ALL_SHOTS.filter(function(s){return s.porteroName===curSeasonFilter;});'
+'  var filtered=seasonZoneFilter?(function(){var gz=_SGMAP[seasonZoneFilter]||[seasonZoneFilter];return fS.filter(function(s){return gz.indexOf(s.zone)>=0;});})():fS;'
+'  drawSeasonRadar(filtered);drawSeasonGoal(filtered);buildZoneRows(filtered);'
+'}'
+'function buildZoneRows(shots){'
+'  var tb=document.querySelector(".zone-season-table tbody");if(!tb)return;'
+'  var GROUPS=[{l:"9m total",z:["Lateral izq","Central","Lateral der"]},{l:"6m total",z:["6m izq","6m cent","6m der"]},{l:"Extremos",z:["Extremo izq","Extremo der"]}];'
+'  var REST=["Contraataque","7 metros"];'
+'  var t="padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.04)";'
+'  function row(lbl,sh,bold,ind){'
+'    if(!sh.length)return "";'
+'    var par=sh.filter(function(s){return s.result==="parada";}).length;'
+'    var gol=sh.filter(function(s){return s.result==="gol"||s.result==="sinportero";}).length;'
+'    var fu=sh.filter(function(s){return s.result==="fuera";}).length;'
+'    var lanz=sh.filter(function(s){return s.result!=="fuera"&&s.result!=="sinportero"&&!s.noGk;}).length;'
+'    var pp=lbl==="7 metros"?(sh.length>0?Math.round((par+fu)/sh.length*1000)/10:null):(lanz>0?Math.round(par/lanz*1000)/10:null);'
+'    var pc=pp===null?"#64748b":pp>=40?"#6366f1":pp>=35?"#38bdf8":pp>=30?"#16a34a":pp>=25?"#86efac":pp>=20?"#fb923c":"#ef4444";'
+'    var bt=bold?"border-top:2px solid rgba(255,255,255,.15)":"border-top:1px solid rgba(255,255,255,.04)";'
+'    var bg=bold?"rgba(255,255,255,.03)":"rgba(255,255,255,.01)";'
+'    var name=ind?"<span style=padding-left:14px;color:#94a3b8;font-size:12px>"+lbl+"</span>":lbl;'
+'    var g=calcularGSAx(sh,null);'
+'    var esperadas=g.tirosConDato?Math.round((g.tirosConDato-g.xGOTRecibido)*100)/100:null;'
+'    var balTd=g.gsax===null?"<td style=\'"+t+";text-align:center;color:#64748b\'>\u2014</td>":"<td style=\'"+t+";text-align:center;color:"+(g.gsax>=0?"#22c55e":"#ef4444")+";font-weight:600\' title=\'Paradas esperadas: "+esperadas+" \u00b7 Paradas reales: "+g.paradas+"\'>"+(g.gsax>0?"+":"")+g.gsax+"</td>";'
+'    var gsaxTd=!g.tirosConDato?"<td style=\'"+t+";text-align:center;color:#64748b\'>\u2014</td>":"<td style=\'"+t+";text-align:center;color:#cbd5e1\' title=\'Sobre "+g.tirosConDato+" tiros a puerta con zona de porter\u00eda registrada\'>"+g.xGOTRecibido+"</td>";'
+'    return "<tr data-zone=\'"+ lbl +"\'  style=\'"+ bt +";background:"+ bg +";cursor:pointer\'>"+"<td style=\'"+ t +"\'>"+name+"</td>"+"<td style=\'"+ t +";text-align:center\'>"+sh.length+"</td>"+"<td style=\'"+ t +";text-align:center\'>"+par+"</td>"+"<td style=\'"+ t +";text-align:center\'>"+gol+"</td>"+"<td style=\'"+ t +";text-align:center\'>"+fu+"</td>"+"<td style=\'"+ t +";text-align:center;color:"+ pc +";font-weight:600\'>"+( pp!==null?pp+"%"+(lbl==="7 metros"?"*":""):"\u2014")+"</td>"+gsaxTd+balTd+"</tr>";'
+'  }'
+'  var html="";'
+'  GROUPS.forEach(function(g){'
+'    html+=row(g.l,shots.filter(function(s){return g.z.indexOf(s.zone)>=0;}),true,false);'
+'    g.z.forEach(function(z){html+=row(z,shots.filter(function(s){return s.zone===z;}),false,true);});'
+'  });'
+'  REST.forEach(function(z){html+=row(z,shots.filter(function(s){return s.zone===z;}),true,false);});'
+'  tb.innerHTML=html;'
+'}'
+'function applySeasonFilter(name){seasonZoneFilter=null;document.querySelectorAll(".zone-season-table tr[data-zone]").forEach(function(r){r.style.background="";r.style.outline="";});curSeasonFilter=name;if(typeof window._loadSeasonObs==="function")window._loadSeasonObs(name);document.querySelectorAll(".pcard").forEach(function(c){var a=c.dataset.filter===name;c.style.background=a?"#1c2e4a":"#111f3a";c.style.borderColor=a?c.querySelector("div").style.color:"rgba(255,255,255,.06)";});var nDS=name==="TODOS"?CHART_DS:CHART_DS.filter(function(d){return d.label===name||d.type==="line";});seasonChart.data.datasets=nDS;seasonChart.update();var tb=document.querySelector("tbody");if(tb){tb.querySelectorAll("tr").forEach(function(row){if(name==="TODOS"){row.style.display="";return;}var idx=PORTERO_NAMES.indexOf(name);var colIdx=idx>=0?3+idx:-1;row.style.display=(colIdx>=0&&row.cells[colIdx]&&row.cells[colIdx].textContent.trim()!=="—")?"":"none";});}var fS=name==="TODOS"?ALL_SHOTS:ALL_SHOTS.filter(function(s){return s.porteroName===name;});if(typeof seasonHabFilter!=="undefined"&&seasonHabFilter)fS=fS.filter(function(s){return s.hab;});drawSeasonRadar(fS);drawSeasonGoal(fS);buildZoneRows(fS);var og=document.getElementById("otras-grid");if(og&&typeof ALL_OTRAS!=="undefined"){while(og.firstChild)og.removeChild(og.firstChild);ODEFS_DATA.forEach(function(d){var v=ALL_OTRAS.filter(function(e){return e.key===d.key&&(name==="TODOS"||e.porteroName===name);}).length;if(!v)return;var it=document.createElement("div");it.style.cssText="display:flex;align-items:center;gap:5px;padding:4px 6px;background:rgba(255,255,255,.04);border-radius:5px;flex-direction:column;align-items:flex-start";var lbl=document.createElement("div");lbl.style.cssText="font-size:9px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%";lbl.textContent=d.label;var val=document.createElement("div");val.style.cssText="font-family:Bebas Neue,sans-serif;font-size:16px;color:#f8fafc;line-height:1";val.textContent=v;it.appendChild(lbl);it.appendChild(val);og.appendChild(it);});if(!og.children.length){var sp=document.createElement("span");sp.style.cssText="font-size:11px;color:#374151";sp.textContent="Sin datos";og.appendChild(sp);}}var spSeason=fS.filter(function(s){return s.result==="sinportero"||(s.noGk&&s.result==="gol");}).length;var spEl=document.getElementById("season-sp");if(!spEl){spEl=document.createElement("div");spEl.id="season-sp";spEl.style.cssText="margin-top:8px;padding:4px 8px;border-radius:5px;background:rgba(255,255,255,.04);display:flex;align-items:center;gap:8px";og&&og.parentNode?og.parentNode.appendChild(spEl):null;}if(spSeason>0){spEl.innerHTML="<span style=font-size:14px>&#9917;</span><span style=flex:1;color:#64748b;font-size:9px>Sin portero</span><span style=font-family:Bebas Neue,sans-serif;font-size:18px;color:rgba(156,163,175,.8)>"+spSeason+"</span>";spEl.style.display="flex";}else{spEl.style.display="none";}}'
    +'function initPhotoDrag(){document.querySelectorAll(".scard-photo").forEach(function(c){var img=c.querySelector("img");if(!img)return;var drag=false,sx=0,sy=0,sox=50,soy=20;function getOx(){var p=(img.style.objectPosition||"50% 20%").split(" ");return parseFloat(p[0])||50;}function getOy(){var p=(img.style.objectPosition||"50% 20%").split(" ");return parseFloat(p[1])||20;}function move(nx,ny){nx=Math.max(0,Math.min(100,nx));ny=Math.max(0,Math.min(100,ny));img.style.objectPosition=nx+"% "+ny+"%";}c.addEventListener("mousedown",function(e){e.preventDefault();e.stopPropagation();drag=true;sx=e.clientX;sy=e.clientY;sox=getOx();soy=getOy();c.style.cursor="grabbing";});document.addEventListener("mousemove",function(e){if(!drag)return;move(sox-(e.clientX-sx)*0.5,soy-(e.clientY-sy)*0.5);});document.addEventListener("mouseup",function(){if(drag){drag=false;c.style.cursor="grab";}});c.addEventListener("touchstart",function(e){e.stopPropagation();drag=true;var t=e.touches[0];sx=t.clientX;sy=t.clientY;sox=getOx();soy=getOy();c.style.cursor="grabbing";},{passive:true});c.addEventListener("touchmove",function(e){if(!drag)return;var t=e.touches[0];move(sox-(t.clientX-sx)*0.5,soy-(t.clientY-sy)*0.5);},{passive:true});c.addEventListener("touchend",function(){drag=false;c.style.cursor="grab";},{passive:true});});}'
    +'function hkCloseSeason(){try{if(parent&&parent!==window){var o=parent.document.getElementById("season-overlay");if(o){o.remove();return;}}}catch(e){}try{window.parent.postMessage("hk-close-season","*");}catch(e){}window.close();}'
    +'window.addEventListener("beforeprint",function(){if(typeof curSeasonFilter!=="undefined"&&curSeasonFilter&&curSeasonFilter!=="TODOS"){document.body.classList.add("pf-on");var sel=null;document.querySelectorAll(".pcard").forEach(function(c){if(c.dataset.filter===curSeasonFilter){c.classList.add("pf-sel");sel=c;}});var ow=document.getElementById("otras-wrap");if(sel&&ow){window._otrasHome={p:ow.parentNode,n:ow.nextSibling};sel.appendChild(ow);}}});'
    +'window.addEventListener("afterprint",function(){document.body.classList.remove("pf-on");document.querySelectorAll(".pf-sel").forEach(function(c){c.classList.remove("pf-sel");});var ow=document.getElementById("otras-wrap");if(ow&&window._otrasHome){window._otrasHome.p.insertBefore(ow,window._otrasHome.n);window._otrasHome=null;}});'
    +'function openRivales(jumpTo){var m=ALL_MATCHES,rm={};m.forEach(function(x){var r=x.rival||"Sin rival";if(!rm[r])rm[r]=[];rm[r].push(x);});var rivals=Object.keys(rm).sort();var RD=rivals.map(function(r){return {rival:r,matches:rm[r]};});var RD_STR=JSON.stringify(RD);var CODE_B64="dmFyIGNSPW51bGw7CmZ1bmN0aW9uIF9lSChzKXt2YXIgZD1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtkLnRleHRDb250ZW50PShzPT1udWxsPycnOnMpO3JldHVybiBkLmlubmVySFRNTDt9CmZ1bmN0aW9uIHBDKHApe3JldHVybiBwPT09bnVsbD8nIzY0NzQ4Yic6cD49NDA/JyM2MzY2ZjEnOnA+PTM1PycjMzhiZGY4JzpwPj0zMD8nIzE2YTM0YSc6cD49MjU/JyM4NmVmYWMnOnA+PTIwPycjZmI5MjNjJzonI2VmNDQ0NCc7fQpmdW5jdGlvbiBwQShwKXtyZXR1cm4gcD09PW51bGw/JyM2NDc0OGInOnA+PTM1PycjZWY0NDQ0JzpwPj0yNT8nI2ZiOTIzYyc6cD49MTU/JyM4NmVmYWMnOnA+PTEwPycjMTZhMzRhJzonIzM4YmRmOCc7fQpmdW5jdGlvbiBzaG93KGlkKXtbJ3JpdmFscycsJ3BsYXllcnMnLCdyZXBvcnQnXS5mb3JFYWNoKGZ1bmN0aW9uKHBnKXt2YXIgZWw9ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3BnLScrcGcpO2lmKGVsKXtlbC5zdHlsZS5kaXNwbGF5PXBnPT09aWQ/J2Jsb2NrJzonbm9uZSc7fX0pOyB9CmZ1bmN0aW9uIGluaXQoKXtkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcuYmsnKS5mb3JFYWNoKGZ1bmN0aW9uKGEsaSl7YS5vbmNsaWNrPWZ1bmN0aW9uKGUpe2UucHJldmVudERlZmF1bHQoKTtzaG93KGk9PT0wPydyaXZhbHMnOidwbGF5ZXJzJyk7fTt9KTtiUigpO3Nob3coJ3JpdmFscycpO30KZnVuY3Rpb24gYlIoKXsKICB2YXIgZWw9ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3JsJyk7ZWwuaW5uZXJIVE1MPScnOwogIFJELmZvckVhY2goZnVuY3Rpb24ocmQsaSl7CiAgICB2YXIgbk09cmQubWF0Y2hlcy5sZW5ndGgsblM9MDsKICAgIHJkLm1hdGNoZXMuZm9yRWFjaChmdW5jdGlvbihtKXtuUys9KG0uc2hvdHN8fFtdKS5sZW5ndGg7fSk7CiAgICB2YXIgZD1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtkLmNsYXNzTmFtZT0nY2QnOwogICAgZC5pbm5lckhUTUw9JzxkaXYgY2xhc3M9Y3Q+JytfZUgocmQucml2YWwpKyc8L2Rpdj48ZGl2IGNsYXNzPWNtPicrbk0rJyBwYXJ0aWRvJysobk0+MT8ncyc6JycpKycgJm1pZGRvdDsgJytuUysnIGxhbnphbWllbnRvczwvZGl2Pic7CiAgICBkLm9uY2xpY2s9KGZ1bmN0aW9uKGkpe3JldHVybiBmdW5jdGlvbigpe29SKGkpO307fSkoaSk7CiAgICBlbC5hcHBlbmRDaGlsZChkKTsKICB9KTsKfQpmdW5jdGlvbiBvUihpKXsKICBjUj1pO3ZhciByZD1SRFtpXTsKICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmgnKS50ZXh0Q29udGVudD1yZC5yaXZhbDsKICAvLyBTaG93IG1hdGNoZXMgYnV0dG9uCiAgdmFyIG1hdGNoQnRuPWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdyaXZhbC1tYXRjaGVzLWJ0bicpOwogIGlmKG1hdGNoQnRuKXttYXRjaEJ0bi5zdHlsZS5kaXNwbGF5PSdpbmxpbmUtZmxleCc7bWF0Y2hCdG4ub25jbGljaz1mdW5jdGlvbigpe29wZW5SaXZhbE1hdGNoZXMoaSk7fTt9CiAgdmFyIGVsPWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwbCcpO2VsLmlubmVySFRNTD0nJzsKICAvLyBEZWR1cGxpY2F0ZSBieSBub3JtYWxpemVkIG5hbWUKICB2YXIgYW1LZXk9e307dmFyIGFtU2hvdHM9e307CiAgcmQubWF0Y2hlcy5mb3JFYWNoKGZ1bmN0aW9uKG0peyhtLnNob3RzfHxbXSkuZm9yRWFjaChmdW5jdGlvbihzKXsKICAgIHZhciBuPShzLmF0dGFja2VyfHwnJykudHJpbSgpO2lmKCFufHxuPT09Jy0tJyluPSdEZXNjb25vY2lkYSc7CiAgICB2YXIga2V5PW4udG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9ccysvZywnICcpOwogICAgaWYoIWFtS2V5W2tleV0pe2FtS2V5W2tleV09bjthbVNob3RzW2tleV09W107fQogICAgYW1TaG90c1trZXldLnB1c2gocyk7CiAgfSk7fSk7CiAgLy8gU29ydCBieSBkb3JzYWwgKG51bWVyaWMpCiAgdmFyIGtleXM9T2JqZWN0LmtleXMoYW1LZXkpLnNvcnQoZnVuY3Rpb24oYSxiKXsKICAgIHZhciBkYT1wYXJzZUludChhbUtleVthXSl8fDk5OSxkYj1wYXJzZUludChhbUtleVtiXSl8fDk5OTsKICAgIHJldHVybiBkYSE9PWRiP2RhLWRiOmFtS2V5W2FdLmxvY2FsZUNvbXBhcmUoYW1LZXlbYl0sJ2VzJyk7CiAgfSk7CiAgaWYoIWtleXMubGVuZ3RoKXtlbC5pbm5lckhUTUw9JzxkaXYgc3R5bGU9ImNvbG9yOiM2NDc0OGI7cGFkZGluZzoyMHB4Ij5TaW4gbGFuemFtaWVudG9zIHJlZ2lzdHJhZG9zPC9kaXY+JztyZXR1cm47fQogIGtleXMuZm9yRWFjaChmdW5jdGlvbihrZXkpewogICAgdmFyIG5hbWU9YW1LZXlba2V5XTt2YXIgc2hvdHM9YW1TaG90c1trZXldOwogICAgdmFyIGdvbD1zaG90cy5maWx0ZXIoZnVuY3Rpb24ocyl7cmV0dXJuIHMucmVzdWx0PT09J2dvbCd8fHMucmVzdWx0PT09J3NpbnBvcnRlcm8nO30pLmxlbmd0aDsKICAgIHZhciBwYXI9c2hvdHMuZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLnJlc3VsdD09PSdwYXJhZGEnO30pLmxlbmd0aDsKICAgIHZhciBsYW56PXNob3RzLmZpbHRlcihmdW5jdGlvbihzKXtyZXR1cm4gcy5yZXN1bHQhPT0nZnVlcmEnO30pLmxlbmd0aDsKICAgIHZhciBwY3Q9bGFuej4wP01hdGgucm91bmQoZ29sL2xhbnoqMTAwKTpudWxsOwogICAgdmFyIGQ9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7ZC5jbGFzc05hbWU9J2NkJzsKICAgIGQuaW5uZXJIVE1MPSc8ZGl2IGNsYXNzPWN0PicrX2VIKG5hbWUpKyc8L2Rpdj48ZGl2IGNsYXNzPWNtPicrc2hvdHMubGVuZ3RoKycgbGFuei4gJm1pZGRvdDsgJytnb2wrJyBnb2wnKyhnb2whPT0xPydlcyc6JycpKycgJm1pZGRvdDsgJytwYXIrJyBwYXJhZGEnKyhwYXIhPT0xPydzJzonJykrKHBjdCE9PW51bGw/JyAmbWlkZG90OyA8c3BhbiBzdHlsZT0iY29sb3I6JytwQyhwY3QpKyciPicrcGN0KyclIGVmaWMuPC9zcGFuPic6JycpKycgPC9kaXY+JzsKICAgIGQub25jbGljaz0oZnVuY3Rpb24oayl7cmV0dXJuIGZ1bmN0aW9uKCl7b1AoYW1LZXlba10sYW1TaG90c1trXSk7fTt9KShrZXkpOwogICAgZWwuYXBwZW5kQ2hpbGQoZCk7CiAgfSk7CiAgLy8gTG9hZCByaXZhbCBvYnNlcnZhdGlvbnMKICBzaG93KCdwbGF5ZXJzJyk7Cn0KdmFyIGN1clBmUGRGaWx0ZXI9bnVsbDsKdmFyIGN1clBsYXllclNob3RzPVtdOwp2YXIgY3VyWm9uZUZpbHRlcj1udWxsOwp2YXIgZ3JvdXBNYXA9eyc5bSB0b3RhbCc6WydMYXRlcmFsIGl6cScsJ0NlbnRyYWwnLCdMYXRlcmFsIGRlciddLCc2bSB0b3RhbCc6Wyc2bSBpenEnLCc2bSBjZW50JywnNm0gZGVyJ10sJ0V4dHJlbW9zJzpbJ0V4dHJlbW8gaXpxJywnRXh0cmVtbyBkZXInXX07CmZ1bmN0aW9uIHNldFpvbmVGaWx0ZXIoem9uZSx0cil7CiAgaWYoY3VyWm9uZUZpbHRlcj09PXpvbmUpe2N1clpvbmVGaWx0ZXI9bnVsbDt9ZWxzZXtjdXJab25lRmlsdGVyPXpvbmU7fQogIHZhciB0Yj1kb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnenQnKTsKICBpZih0YikgQXJyYXkuZnJvbSh0Yi5xdWVyeVNlbGVjdG9yQWxsKCd0cicpKS5mb3JFYWNoKGZ1bmN0aW9uKHIpewogICAgci5zdHlsZS5iYWNrZ3JvdW5kPShjdXJab25lRmlsdGVyJiZyPT09dHIpPydyZ2JhKDk5LDEwMiwyNDEsLjE4KSc6Jyc7CiAgICByLnN0eWxlLm91dGxpbmU9KGN1clpvbmVGaWx0ZXImJnI9PT10cik/JzFweCBzb2xpZCByZ2JhKDk5LDEwMiwyNDEsLjUpJzonJzsKICB9KTsKICB2YXIgc2g9Y3VyUGZQZEZpbHRlcj9jdXJQbGF5ZXJTaG90cy5maWx0ZXIoZnVuY3Rpb24ocyl7cmV0dXJuIGN1clBmUGRGaWx0ZXI9PT0ncGYnP3MucGY6cy5wZDt9KTpjdXJQbGF5ZXJTaG90czsKICB2YXIgZmlsdGVyZWQ9Y3VyWm9uZUZpbHRlcj8oZnVuY3Rpb24oKXsKICAgIHZhciBnej1ncm91cE1hcFtjdXJab25lRmlsdGVyXXx8W2N1clpvbmVGaWx0ZXJdOwogICAgcmV0dXJuIHNoLmZpbHRlcihmdW5jdGlvbihzKXtyZXR1cm4gZ3ouaW5kZXhPZihzLnpvbmUpPj0wO30pOwogIH0pKCk6c2g7CiAgZEYoZmlsdGVyZWQpOwogIGRHKGZpbHRlcmVkKTsKfQpmdW5jdGlvbiBzZXRQZlBkRmlsdGVyKHR5cGUsYnRuKXsKICBjdXJab25lRmlsdGVyPW51bGw7dmFyIHRiPWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd6dCcpO2lmKHRiKUFycmF5LmZyb20odGIucXVlcnlTZWxlY3RvckFsbCgndHInKSkuZm9yRWFjaChmdW5jdGlvbihyKXtyLnN0eWxlLmJhY2tncm91bmQ9Jyc7ci5zdHlsZS5vdXRsaW5lPScnO30pOwogIGlmKGN1clBmUGRGaWx0ZXI9PT10eXBlKXtjdXJQZlBkRmlsdGVyPW51bGw7fWVsc2V7Y3VyUGZQZEZpbHRlcj10eXBlO30KICB2YXIgYnBmPWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdmcC1wZicpOwogIHZhciBicGQ9ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZwLXBkJyk7CiAgaWYoYnBmKXticGYuc3R5bGUuYmFja2dyb3VuZD1jdXJQZlBkRmlsdGVyPT09J3BmJz8ncmdiYSgzNCwxOTcsOTQsLjI1KSc6J3JnYmEoMjU1LDI1NSwyNTUsLjA1KSc7YnBmLnN0eWxlLmJvcmRlckNvbG9yPWN1clBmUGRGaWx0ZXI9PT0ncGYnPycjMjJjNTVlJzoncmdiYSgzNCwxOTcsOTQsLjMpJzt9CiAgaWYoYnBkKXticGQuc3R5bGUuYmFja2dyb3VuZD1jdXJQZlBkRmlsdGVyPT09J3BkJz8ncmdiYSgyMzksNjgsNjgsLjI1KSc6J3JnYmEoMjU1LDI1NSwyNTUsLjA1KSc7YnBkLnN0eWxlLmJvcmRlckNvbG9yPWN1clBmUGRGaWx0ZXI9PT0ncGQnPycjZWY0NDQ0JzoncmdiYSgyMzksNjgsNjgsLjMpJzt9CiAgdmFyIHNoPWN1clBmUGRGaWx0ZXI/Y3VyUGxheWVyU2hvdHMuZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBjdXJQZlBkRmlsdGVyPT09J3BmJz9zLnBmOnMucGQ7fSk6Y3VyUGxheWVyU2hvdHM7CiAgcmVuZGVyUGxheWVyRGF0YShzaCk7Cn0KZnVuY3Rpb24gcmVuZGVyUGxheWVyRGF0YShzaCl7CiAgdmFyIHBhcj1zaC5maWx0ZXIoZnVuY3Rpb24ocyl7cmV0dXJuIHMucmVzdWx0PT09J3BhcmFkYSc7fSkubGVuZ3RoOwogIHZhciBnb2w9c2guZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLnJlc3VsdD09PSdnb2wnfHxzLnJlc3VsdD09PSdzaW5wb3J0ZXJvJzt9KS5sZW5ndGg7CiAgdmFyIGxhbno9c2guZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLnJlc3VsdCE9PSdmdWVyYSc7fSkubGVuZ3RoOwogIHZhciBmdWVyYT1zaC5maWx0ZXIoZnVuY3Rpb24ocyl7cmV0dXJuIHMucmVzdWx0PT09J2Z1ZXJhJzt9KS5sZW5ndGg7CiAgdmFyIHBjdD1sYW56PjA/TWF0aC5yb3VuZChnb2wvbGFueioxMDApOjA7CiAgdmFyIHNpbnBvcnQ9c2guZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLnJlc3VsdD09PSdzaW5wb3J0ZXJvJzt9KS5sZW5ndGg7CiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3hwJykudGV4dENvbnRlbnQ9cGFyOwogIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd4ZycpLnRleHRDb250ZW50PWdvbDsKICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgneGwnKS50ZXh0Q29udGVudD1sYW56OwogIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd4ZicpLnRleHRDb250ZW50PWZ1ZXJhOwogIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd4cGN0JykudGV4dENvbnRlbnQ9cGN0KyclJzsKICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgneHBjdCcpLnN0eWxlLmNvbG9yPXBBKHBjdCk7CiAgdmFyIHhzcD1kb2N1bWVudC5nZXRFbGVtZW50QnlJZCgneHNpbnBvcnQnKTsKICBpZih4c3ApeHNwLnRleHRDb250ZW50PXNpbnBvcnQ7CiAgdmFyIHpvbmVzPVsnRXh0cmVtbyBpenEnLCdFeHRyZW1vIGRlcicsJzZtIGl6cScsJzZtIGNlbnQnLCc2bSBkZXInLCdMYXRlcmFsIGl6cScsJ0NlbnRyYWwnLCdMYXRlcmFsIGRlcicsJzcgbWV0cm9zJywnQ29udHJhYXRhcXVlJ107CiAgdmFyIHRiPWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCd6dCcpO3RiLmlubmVySFRNTD0nJzsKICB6b25lcy5mb3JFYWNoKGZ1bmN0aW9uKHopewogICAgdmFyIHN6PXNoLmZpbHRlcihmdW5jdGlvbihzKXtyZXR1cm4gcy56b25lPT09ejt9KTsKICAgIGlmKCFzei5sZW5ndGgpcmV0dXJuOwogICAgdmFyIHA9c3ouZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLnJlc3VsdD09PSdwYXJhZGEnO30pLmxlbmd0aDsKICAgIHZhciBnPXN6LmZpbHRlcihmdW5jdGlvbihzKXtyZXR1cm4gcy5yZXN1bHQ9PT0nZ29sJ3x8cy5yZXN1bHQ9PT0nc2lucG9ydGVybyc7fSkubGVuZ3RoOwogICAgdmFyIGw9c3ouZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLnJlc3VsdCE9PSdmdWVyYSc7fSkubGVuZ3RoOwogICAgdmFyIHBwPWw+MD9NYXRoLnJvdW5kKGcvbCoxMDApOm51bGw7CiAgICB2YXIgdGM9cEEocHApOwogICAgdmFyIHRyPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RyJyk7CiAgICB0ci5zdHlsZS5jdXJzb3I9J3BvaW50ZXInOwogICAgdHIub25jbGljaz0oZnVuY3Rpb24oenope3JldHVybiBmdW5jdGlvbigpe3NldFpvbmVGaWx0ZXIoenosdGhpcyk7fTt9KSh6KTsKICAgIHRyLmlubmVySFRNTD0nPHRkPicreisnPC90ZD48dGQ+JytzaC5maWx0ZXIoZnVuY3Rpb24ocyl7cmV0dXJuIHMuem9uZT09PXo7fSkubGVuZ3RoKyc8L3RkPjx0ZD4nK2wrJzwvdGQ+PHRkIHN0eWxlPSJjb2xvcjojMjJjNTVlIj4nK3ArJzwvdGQ+PHRkIHN0eWxlPSJjb2xvcjojZWY0NDQ0Ij4nK2crJzwvdGQ+PHRkIHN0eWxlPSJjb2xvcjonK3RjKyciPicrKHBwIT09bnVsbD9wcCsnJSc6Jy0tJykrJzwvdGQ+JzsKICAgIHRiLmFwcGVuZENoaWxkKHRyKTsKICB9KTsKICAvLyBGaWxhIGVzcGVjaWFsOiBsYW56YW1pZW50b3MgY29uIGhhYmlsaWRhZCDigJQgYWwgZmluYWwKICB2YXIgaGFiUz1zaC5maWx0ZXIoZnVuY3Rpb24ocyl7cmV0dXJuIHMuaGFiO30pOwogIGlmKGhhYlMubGVuZ3RoPjApewogICAgdmFyIGhQPWhhYlMuZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLnJlc3VsdD09PSdwYXJhZGEnO30pLmxlbmd0aDsKICAgIHZhciBoRz1oYWJTLmZpbHRlcihmdW5jdGlvbihzKXtyZXR1cm4gcy5yZXN1bHQ9PT0nZ29sJ3x8cy5yZXN1bHQ9PT0nc2lucG9ydGVybyc7fSkubGVuZ3RoOwogICAgdmFyIGhMPWhhYlMuZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLnJlc3VsdCE9PSdmdWVyYSc7fSkubGVuZ3RoOwogICAgdmFyIGhQY3Q9aEw+MD9NYXRoLnJvdW5kKGhQL2hMKjEwMCk6bnVsbDsKICAgIHZhciBoVHI9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndHInKTsKICAgIGhUci5pbm5lckhUTUw9Jzx0ZCBzdHlsZT0iY29sb3I6I2Q4YjRmZTtmb250LXdlaWdodDo2MDAiPuKcqCBDb24gaGFiaWxpZGFkPC90ZD48dGQ+JytoYWJTLmxlbmd0aCsnPC90ZD48dGQ+JytoTCsnPC90ZD48dGQgc3R5bGU9ImNvbG9yOiMyMmM1NWUiPicraFArJzwvdGQ+PHRkIHN0eWxlPSJjb2xvcjojZWY0NDQ0Ij4nK2hHKyc8L3RkPjx0ZCBzdHlsZT0iY29sb3I6I2Y1OWUwYiI+JysoaFBjdCE9PW51bGw/aFBjdCsnJSc6Jy0tJykrJzwvdGQ+JzsKICAgIGhUci5zdHlsZS5jc3NUZXh0PSdib3JkZXItdG9wOjJweCBzb2xpZCByZ2JhKDE2OCw4NSwyNDcsLjMpO2JvcmRlci1ib3R0b206MnB4IHNvbGlkIHJnYmEoMTY4LDg1LDI0NywuMyknOwogICAgdGIuYXBwZW5kQ2hpbGQoaFRyKTsKICB9CiAgLy8gRmlsYXMgZGUgdHJheWVjdG9yaWE6IGNydXphZG8gLyBwYXJhbGVsbwogIFsnY3J1emFkbycsJ3BhcmFsZWxvJ10uZm9yRWFjaChmdW5jdGlvbih0cmFqKXsKICAgIHZhciB0Uz1zaC5maWx0ZXIoZnVuY3Rpb24ocyl7cmV0dXJuIHMudHJhaj09PXRyYWo7fSk7CiAgICBpZighdFMubGVuZ3RoKSByZXR1cm47CiAgICB2YXIgdFA9dFMuZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLnJlc3VsdD09PSdwYXJhZGEnO30pLmxlbmd0aDsKICAgIHZhciB0Rz10Uy5maWx0ZXIoZnVuY3Rpb24ocyl7cmV0dXJuIHMucmVzdWx0PT09J2dvbCd8fHMucmVzdWx0PT09J3NpbnBvcnRlcm8nO30pLmxlbmd0aDsKICAgIHZhciB0TD10Uy5maWx0ZXIoZnVuY3Rpb24ocyl7cmV0dXJuIHMucmVzdWx0IT09J2Z1ZXJhJzt9KS5sZW5ndGg7CiAgICB2YXIgdFBjdD10TD4wP01hdGgucm91bmQodFAvdEwqMTAwKTpudWxsOwogICAgdmFyIHRUcj1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0cicpOwogICAgdmFyIGljb249dHJhaj09PSdjcnV6YWRvJz8n4pyVIENydXphZG8nOifigJYgUGFyYWxlbG8nOwogICAgdmFyIGNvbD10cmFqPT09J2NydXphZG8nPycjZmNhNWE1JzonIzg2ZWZhYyc7CiAgICB2YXIgYmRyPXRyYWo9PT0nY3J1emFkbyc/J3JnYmEoMjM5LDY4LDY4LC4zKSc6J3JnYmEoMzQsMTk3LDk0LC4zKSc7CiAgICB0VHIuaW5uZXJIVE1MPSc8dGQgc3R5bGU9ImNvbG9yOicrY29sKyc7Zm9udC13ZWlnaHQ6NjAwIj4nK2ljb24rJzwvdGQ+PHRkPicrdFMubGVuZ3RoKyc8L3RkPjx0ZD4nK3RMKyc8L3RkPjx0ZCBzdHlsZT0iY29sb3I6IzIyYzU1ZSI+Jyt0UCsnPC90ZD48dGQgc3R5bGU9ImNvbG9yOiNlZjQ0NDQiPicrdEcrJzwvdGQ+PHRkIHN0eWxlPSJjb2xvcjojZjU5ZTBiIj4nKyh0UGN0IT09bnVsbD90UGN0KyclJzonLS0nKSsnPC90ZD4nOwogICAgdFRyLnN0eWxlLmNzc1RleHQ9J2JvcmRlci10b3A6MnB4IHNvbGlkICcrYmRyKyc7Ym9yZGVyLWJvdHRvbToycHggc29saWQgJytiZHI7CiAgICB0Yi5hcHBlbmRDaGlsZCh0VHIpOwogIH0pOwogIHZhciBnb2FsU2g9Y3VyWm9uZUZpbHRlcj8oZnVuY3Rpb24oKXt2YXIgZ3o9Z3JvdXBNYXBbY3VyWm9uZUZpbHRlcl18fFtjdXJab25lRmlsdGVyXTtyZXR1cm4gc2guZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBnei5pbmRleE9mKHMuem9uZSk+PTA7fSk7fSkoKQogICAgOnNoOwogIGRGKGdvYWxTaCk7CiAgZEcoZ29hbFNoKTsKfQpmdW5jdGlvbiBvUChuYW1lLCBwcmVTaG90cyl7CiAgdmFyIHJkPVJEW2NSXTsKICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncmVoJykudGV4dENvbnRlbnQ9cmQucml2YWw7CiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3BuaCcpLnRleHRDb250ZW50PW5hbWU7CiAgY3VyUGZQZEZpbHRlcj1udWxsOwogIGlmKHByZVNob3RzKXsKICAgIGN1clBsYXllclNob3RzPXByZVNob3RzOwogIH0gZWxzZSB7CiAgICBjdXJQbGF5ZXJTaG90cz1bXTsKICAgIHZhciBub3JtTj1uYW1lLnRyaW0oKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1xzKy9nLCcgJyk7CiAgICByZC5tYXRjaGVzLmZvckVhY2goZnVuY3Rpb24obSl7KG0uc2hvdHN8fFtdKS5mb3JFYWNoKGZ1bmN0aW9uKHMpewogICAgICB2YXIgbj0ocy5hdHRhY2tlcnx8JycpLnRyaW0oKTtpZighbnx8bj09PSctLScpbj0nRGVzY29ub2NpZGEnOwogICAgICBpZihuLnRyaW0oKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1xzKy9nLCcgJyk9PT1ub3JtTiljdXJQbGF5ZXJTaG90cy5wdXNoKHMpOwogICAgfSk7fSk7CiAgfQogIHZhciBuUGY9Y3VyUGxheWVyU2hvdHMuZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLnBmO30pLmxlbmd0aDsKICB2YXIgblBkPWN1clBsYXllclNob3RzLmZpbHRlcihmdW5jdGlvbihzKXtyZXR1cm4gcy5wZDt9KS5sZW5ndGg7CiAgdmFyIHRvdD1jdXJQbGF5ZXJTaG90cy5sZW5ndGg7CiAgdmFyIHBjdFBmPXRvdD4wP01hdGgucm91bmQoblBmL3RvdCoxMDApOjA7CiAgdmFyIHBjdFBkPXRvdD4wP01hdGgucm91bmQoblBkL3RvdCoxMDApOjA7CiAgLy8gSW5qZWN0IFBGL1BEIGZpbHRlciBidXR0b25zIGludG8gaGVhZGVyIGFyZWEKICB2YXIgcGZQZERpdj1kb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncGYtcGQtZmlsdGVyJyk7CiAgaWYocGZQZERpdil7CiAgICBwZlBkRGl2LmlubmVySFRNTD0nJzsKICAgIGlmKG5QZj4wfHxuUGQ+MCl7CiAgICAgIHBmUGREaXYuc3R5bGUuZGlzcGxheT0nZmxleCc7CiAgICAgIGlmKG5QZj4wKXsKICAgICAgICB2YXIgYnBmPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2J1dHRvbicpOwogICAgICAgIGJwZi5pZD0nZnAtcGYnOwogICAgICAgIGJwZi5vbmNsaWNrPWZ1bmN0aW9uKCl7c2V0UGZQZEZpbHRlcigncGYnLHRoaXMpO307CiAgICAgICAgYnBmLnN0eWxlLmNzc1RleHQ9J2ZsZXg6MTtwYWRkaW5nOjEwcHggMTJweDtib3JkZXItcmFkaXVzOjEwcHg7Ym9yZGVyOjJweCBzb2xpZCByZ2JhKDM0LDE5Nyw5NCwuMyk7YmFja2dyb3VuZDpyZ2JhKDI1NSwyNTUsMjU1LC4wNSk7Y29sb3I6Izg2ZWZhYztmb250LWZhbWlseTpETSBTYW5zLHNhbnMtc2VyaWY7Y3Vyc29yOnBvaW50ZXI7dHJhbnNpdGlvbjphbGwgLjE1czt0ZXh0LWFsaWduOmNlbnRlcic7CiAgICAgICAgYnBmLmlubmVySFRNTD0nPGRpdiBzdHlsZT0iZm9udC1zaXplOjExcHg7Y29sb3I6IzY0NzQ4Yjt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjhweDttYXJnaW4tYm90dG9tOjJweCI+UHVudG8gRnVlcnRlPC9kaXY+PGRpdiBzdHlsZT0iZm9udC1mYW1pbHk6QmViYXMgTmV1ZSxzYW5zLXNlcmlmO2ZvbnQtc2l6ZToyOHB4O2xpbmUtaGVpZ2h0OjE7Y29sb3I6IzIyYzU1ZSI+JytuUGYrJzwvZGl2PjxkaXYgc3R5bGU9ImZvbnQtc2l6ZToxMXB4O2NvbG9yOiM2NDc0OGI7bWFyZ2luLXRvcDoycHgiPicrcGN0UGYrJyUgZGVsIHRvdGFsPC9kaXY+JzsKICAgICAgICBwZlBkRGl2LmFwcGVuZENoaWxkKGJwZik7CiAgICAgIH0KICAgICAgaWYoblBkPjApewogICAgICAgIHZhciBicGQ9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7CiAgICAgICAgYnBkLmlkPSdmcC1wZCc7CiAgICAgICAgYnBkLm9uY2xpY2s9ZnVuY3Rpb24oKXtzZXRQZlBkRmlsdGVyKCdwZCcsdGhpcyk7fTsKICAgICAgICBicGQuc3R5bGUuY3NzVGV4dD0nZmxleDoxO3BhZGRpbmc6MTBweCAxMnB4O2JvcmRlci1yYWRpdXM6MTBweDtib3JkZXI6MnB4IHNvbGlkIHJnYmEoMjM5LDY4LDY4LC4zKTtiYWNrZ3JvdW5kOnJnYmEoMjU1LDI1NSwyNTUsLjA1KTtjb2xvcjojZmNhNWE1O2ZvbnQtZmFtaWx5OkRNIFNhbnMsc2Fucy1zZXJpZjtjdXJzb3I6cG9pbnRlcjt0cmFuc2l0aW9uOmFsbCAuMTVzO3RleHQtYWxpZ246Y2VudGVyJzsKICAgICAgICBicGQuaW5uZXJIVE1MPSc8ZGl2IHN0eWxlPSJmb250LXNpemU6MTFweDtjb2xvcjojNjQ3NDhiO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouOHB4O21hcmdpbi1ib3R0b206MnB4Ij5QdW50byBEw6liaWw8L2Rpdj48ZGl2IHN0eWxlPSJmb250LWZhbWlseTpCZWJhcyBOZXVlLHNhbnMtc2VyaWY7Zm9udC1zaXplOjI4cHg7bGluZS1oZWlnaHQ6MTtjb2xvcjojZWY0NDQ0Ij4nK25QZCsnPC9kaXY+PGRpdiBzdHlsZT0iZm9udC1zaXplOjExcHg7Y29sb3I6IzY0NzQ4YjttYXJnaW4tdG9wOjJweCI+JytwY3RQZCsnJSBkZWwgdG90YWw8L2Rpdj4nOwogICAgICAgIHBmUGREaXYuYXBwZW5kQ2hpbGQoYnBkKTsKICAgICAgfQogICAgfSBlbHNlIHsKICAgICAgcGZQZERpdi5zdHlsZS5kaXNwbGF5PSdub25lJzsKICAgIH0KICB9CiAgLy8gQnV0dG9uIGJhcjogcmlnaHQtYWxpZ25lZAogIHZhciBidG5CYXI9ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3BsYXllci1idG4tYmFyJyk7CiAgaWYoIWJ0bkJhcil7CiAgICBidG5CYXI9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7CiAgICBidG5CYXIuaWQ9J3BsYXllci1idG4tYmFyJzsKICAgIGJ0bkJhci5zdHlsZS5jc3NUZXh0PSdkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OmZsZXgtZW5kO2dhcDoxMnB4O21hcmdpbi1ib3R0b206MTZweDtmbGV4LXdyYXA6d3JhcCc7CiAgICB2YXIgbWF0Y2hlc0J0bj1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKTsKICAgIG1hdGNoZXNCdG4uaWQ9J3BsYXllci1tYXRjaGVzLWJ0bic7CiAgICBtYXRjaGVzQnRuLnN0eWxlLmNzc1RleHQ9J3BhZGRpbmc6OHB4IDE4cHg7Ym9yZGVyLXJhZGl1czo4cHg7Ym9yZGVyOjFweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC4xNSk7YmFja2dyb3VuZDpyZ2JhKDI1NSwyNTUsMjU1LC4wOCk7Y29sb3I6Izk0YTNiODtmb250LWZhbWlseTpETSBTYW5zLHNhbnMtc2VyaWY7Zm9udC1zaXplOjEzcHg7Y3Vyc29yOnBvaW50ZXInOwogICAgbWF0Y2hlc0J0bi50ZXh0Q29udGVudD0n8J+TiyBJciBhbCBwYXJ0aWRvJzsKICAgIHZhciBwZGZCdG49ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYnV0dG9uJyk7CiAgICBwZGZCdG4uaWQ9J3JpdmFsLXBkZi1idG4nOwogICAgcGRmQnRuLnN0eWxlLmNzc1RleHQ9J3BhZGRpbmc6OHB4IDE4cHg7Ym9yZGVyLXJhZGl1czo4cHg7Ym9yZGVyOm5vbmU7YmFja2dyb3VuZDpsaW5lYXItZ3JhZGllbnQoMTM1ZGVnLCNkYzI2MjYsI2I5MWMxYyk7Y29sb3I6I2ZmZjtmb250LWZhbWlseTpETSBTYW5zLHNhbnMtc2VyaWY7Zm9udC1zaXplOjEzcHg7Y3Vyc29yOnBvaW50ZXInOwogICAgcGRmQnRuLnRleHRDb250ZW50PSfwn5ao77iPIEV4cG9ydGFyIFBERic7CiAgICBwZGZCdG4ub25jbGljaz1mdW5jdGlvbigpe3dpbmRvdy5wcmludCgpO307CiAgICBidG5CYXIuYXBwZW5kQ2hpbGQobWF0Y2hlc0J0bik7CiAgICBidG5CYXIuYXBwZW5kQ2hpbGQocGRmQnRuKTsKICAgIHZhciBwZ3I9ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3BnLXJlcG9ydCcpOwogICAgdmFyIHJlZj1wZ3IuZmlyc3RDaGlsZD9wZ3IuZmlyc3RDaGlsZC5uZXh0U2libGluZzpudWxsOwogICAgcGdyLmluc2VydEJlZm9yZShidG5CYXIscmVmKTsKICB9CiAgdmFyIG1iPWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdwbGF5ZXItbWF0Y2hlcy1idG4nKTsKICBpZihtYikgbWIub25jbGljaz0oZnVuY3Rpb24obixzKXtyZXR1cm4gZnVuY3Rpb24oKXtvcGVuUGxheWVyTWF0Y2hlcyhuLHMpO307fSkobmFtZSxjdXJQbGF5ZXJTaG90cyk7CiAgc2hvdygncmVwb3J0Jyk7CiAgc2V0VGltZW91dChmdW5jdGlvbigpewogICAgcmVuZGVyUGxheWVyRGF0YShjdXJQbGF5ZXJTaG90cyk7CiAgICAvLyBPYnNlcnZhY2lvbmVzIHBvciBqdWdhZG9yYQogICAgdmFyIHBncj1kb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncGctcmVwb3J0Jyk7CiAgICB2YXIgb2JzSWQ9J29icy1wbGF5ZXItYm94JzsKICAgIHZhciBvYnNCb3g9ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQob2JzSWQpOwogICAgaWYoIW9ic0JveCl7CiAgICAgIG9ic0JveD1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsKICAgICAgb2JzQm94LmlkPW9ic0lkOwogICAgICBvYnNCb3guc3R5bGUuY3NzVGV4dD0nbWFyZ2luLXRvcDoyMHB4O3BhZGRpbmctdG9wOjE2cHg7Ym9yZGVyLXRvcDoxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuMDgpO3BhZ2UtYnJlYWstaW5zaWRlOmF2b2lkO2JyZWFrLWluc2lkZTphdm9pZCc7CiAgICAgIG9ic0JveC5pbm5lckhUTUw9JzxkaXYgc3R5bGU9ImZvbnQtc2l6ZToxMXB4O2NvbG9yOiM2NDc0OGI7dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2xldHRlci1zcGFjaW5nOi44cHg7bWFyZ2luLWJvdHRvbTo4cHgiPvCfk50gT2JzZXJ2YWNpb25lczwvZGl2PicrCiAgICAgICAgJzx0ZXh0YXJlYSBpZD1vYnMtcGxheWVyLXRhIHBsYWNlaG9sZGVyPSJBw7FhZGUgdHVzIG9ic2VydmFjaW9uZXMgc29icmUgZXN0YSBqdWdhZG9yYS4uLiIgJysKICAgICAgICAnc3R5bGU9IndpZHRoOjEwMCU7Ym94LXNpemluZzpib3JkZXItYm94O2JhY2tncm91bmQ6cmdiYSgyNTUsMjU1LDI1NSwuMDQpO2JvcmRlcjoxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuMSk7JysKICAgICAgICAnYm9yZGVyLXJhZGl1czo4cHg7Y29sb3I6I2NiZDVlMTtmb250LWZhbWlseTpETSBTYW5zLHNhbnMtc2VyaWY7Zm9udC1zaXplOjEzcHg7cGFkZGluZzoxMHB4O3Jlc2l6ZTp2ZXJ0aWNhbDttaW4taGVpZ2h0OjgwcHgiPjwvdGV4dGFyZWE+JzsKICAgICAgcGdyLmFwcGVuZENoaWxkKG9ic0JveCk7CiAgICB9CiAgICB2YXIgcml2YWw9UkRbY1JdP1JEW2NSXS5yaXZhbDonJzsKICAgIHZhciBvYnNLZXk9J29ic19wbGF5ZXJfJytyaXZhbCsnXycrbmFtZTsKICAgIHZhciB0YT1kb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnb2JzLXBsYXllci10YScpOwogICAgaWYodGEpewogICAgICB0cnl7dGEudmFsdWU9bG9jYWxTdG9yYWdlLmdldEl0ZW0ob2JzS2V5KXx8Jyc7fWNhdGNoKGUpe30KICAgICAgdGEub25pbnB1dD1mdW5jdGlvbigpe3RyeXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbShvYnNLZXksdGhpcy52YWx1ZSk7fWNhdGNoKGUpe307fTsKICAgIH0KICB9LDUwKTsKfQpmdW5jdGlvbiBvcGVuUGxheWVyTWF0Y2hlcyhuYW1lLCBwbGF5ZXJTaG90cyl7CiAgdmFyIHJkPVJEW2NSXTsKICB2YXIgbm9ybU49bmFtZS50cmltKCkudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9ccysvZywnICcpOwogIHZhciBtYXRjaGVzV2l0aFBsYXllcj1bXTsKICByZC5tYXRjaGVzLmZvckVhY2goZnVuY3Rpb24obSl7CiAgICB2YXIgaGFzPShtLnNob3RzfHxbXSkuc29tZShmdW5jdGlvbihzKXsKICAgICAgdmFyIG49KHMuYXR0YWNrZXJ8fCcnKS50cmltKCk7aWYoIW58fG49PT0nLS0nKW49J0Rlc2Nvbm9jaWRhJzsKICAgICAgcmV0dXJuIG4udHJpbSgpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXHMrL2csJyAnKT09PW5vcm1OOwogICAgfSk7CiAgICBpZihoYXMpbWF0Y2hlc1dpdGhQbGF5ZXIucHVzaChtKTsKICB9KTsKICBpZighbWF0Y2hlc1dpdGhQbGF5ZXIubGVuZ3RoKXthbGVydCgnTm8gaGF5IHBhcnRpZG9zIGNvbiBsYW56YW1pZW50b3MgZGUgJytuYW1lKTtyZXR1cm47fQogIC8vIEJ1aWxkIGxpc3QgSFRNTAogIHZhciBodG1sPSc8IURPQ1RZUEUgaHRtbD48aHRtbD48aGVhZD48bWV0YSBjaGFyc2V0PVVURi04Pic7CiAgaHRtbCs9Jzx0aXRsZT5QYXJ0aWRvcyBkZSAnK25hbWUrJzwvdGl0bGU+JzsKICBodG1sKz0nPHN0eWxlPmJvZHl7YmFja2dyb3VuZDojMGExNjI4O2NvbG9yOiNjYmQ1ZTE7Zm9udC1mYW1pbHk6RE0gU2FucyxzYW5zLXNlcmlmO3BhZGRpbmc6MjBweDttYXJnaW46MH0nOwogIGh0bWwrPScuY2FyZHtiYWNrZ3JvdW5kOiMxMTFmM2E7Ym9yZGVyLXJhZGl1czoxMnB4O3BhZGRpbmc6MjBweDttYXJnaW4tYm90dG9tOjE2cHh9JzsKICBodG1sKz0nLnRpdGxle2ZvbnQtZmFtaWx5OkJlYmFzIE5ldWUsc2Fucy1zZXJpZjtmb250LXNpemU6MjJweDtjb2xvcjojZjU5ZTBiO21hcmdpbi1ib3R0b206NnB4fSc7CiAgaHRtbCs9Jy5zdWJ7Zm9udC1zaXplOjEzcHg7Y29sb3I6IzY0NzQ4YjttYXJnaW4tYm90dG9tOjE0cHh9JzsKICBodG1sKz0nLml0ZW17YmFja2dyb3VuZDpyZ2JhKDI1NSwyNTUsMjU1LC4wNSk7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6MTRweCAxOHB4O21hcmdpbi1ib3R0b206OHB4O2N1cnNvcjpwb2ludGVyO2JvcmRlcjoxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuMDgpO2Rpc3BsYXk6ZmxleDtqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjthbGlnbi1pdGVtczpjZW50ZXJ9JzsKICBodG1sKz0nLml0ZW06aG92ZXJ7YmFja2dyb3VuZDpyZ2JhKDk5LDEwMiwyNDEsLjE1KTtib3JkZXItY29sb3I6cmdiYSg5OSwxMDIsMjQxLC40KX0nOwogIGh0bWwrPScuZGF0ZXtmb250LXNpemU6MTJweDtjb2xvcjojNjQ3NDhiO21hcmdpbi10b3A6M3B4fSc7CiAgaHRtbCs9Jy5zdGF0c3tmb250LXNpemU6MTJweDtjb2xvcjojOTRhM2I4O3RleHQtYWxpZ246cmlnaHR9JzsKICBodG1sKz0nLmJ0bntiYWNrZ3JvdW5kOmxpbmVhci1ncmFkaWVudCgxMzVkZWcsIzFhNTZkYiwjMjU2M2ViKTtjb2xvcjojZmZmO2JvcmRlcjpub25lO2JvcmRlci1yYWRpdXM6OHB4O3BhZGRpbmc6NnB4IDE0cHg7Y3Vyc29yOnBvaW50ZXI7Zm9udC1zaXplOjEycHg7bWFyZ2luLWxlZnQ6OHB4fSc7CiAgaHRtbCs9Jzwvc3R5bGU+PC9oZWFkPjxib2R5Pic7CiAgaHRtbCs9JzxkaXYgY2xhc3M9Y2FyZD4nOwogIGh0bWwrPSc8ZGl2IGNsYXNzPXRpdGxlPvCfk4sgJytfZUgobmFtZSkrJzwvZGl2Pic7CiAgaHRtbCs9JzxkaXYgY2xhc3M9c3ViPicrbWF0Y2hlc1dpdGhQbGF5ZXIubGVuZ3RoKycgcGFydGlkbycrKG1hdGNoZXNXaXRoUGxheWVyLmxlbmd0aCE9PTE/J3MnOicnKSsnIHZzICcrX2VIKHJkLnJpdmFsKSsnPC9kaXY+JzsKICBodG1sKz0nPGJ1dHRvbiBzdHlsZT0iYmFja2dyb3VuZDpyZ2JhKDI1NSwyNTUsMjU1LC4wOCk7Ym9yZGVyOjFweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC4xNSk7Y29sb3I6Izk0YTNiODtib3JkZXItcmFkaXVzOjhweDtwYWRkaW5nOjdweCAxNHB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToxM3B4IiBvbmNsaWNrPSJ3aW5kb3cuY2xvc2UoKSI+4pyVIENlcnJhcjwvYnV0dG9uPic7CiAgaHRtbCs9JzwvZGl2Pic7CiAgbWF0Y2hlc1dpdGhQbGF5ZXIuZm9yRWFjaChmdW5jdGlvbihtKXsKICAgIHZhciBub3JtTjI9bmFtZS50cmltKCkudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9ccysvZywnICcpOwogICAgdmFyIHBTaG90cz0obS5zaG90c3x8W10pLmZpbHRlcihmdW5jdGlvbihzKXt2YXIgbj0ocy5hdHRhY2tlcnx8JycpLnRyaW0oKTtpZighbnx8bj09PSctLScpbj0nRGVzY29ub2NpZGEnO3JldHVybiBuLnRyaW0oKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1xzKy9nLCcgJyk9PT1ub3JtTjI7fSk7CiAgICB2YXIgZD1tLmRhdGU/bmV3IERhdGUobS5kYXRlKS50b0xvY2FsZURhdGVTdHJpbmcoJ2VzLUVTJyx7ZGF5OicyLWRpZ2l0Jyxtb250aDonc2hvcnQnLHllYXI6J251bWVyaWMnfSk6J1NpbiBmZWNoYSc7CiAgICB2YXIgZ29scz1wU2hvdHMuZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLnJlc3VsdD09PSdnb2wnfHxzLnJlc3VsdD09PSdzaW5wb3J0ZXJvJzt9KS5sZW5ndGg7CiAgICB2YXIgcGFycz1wU2hvdHMuZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLnJlc3VsdD09PSdwYXJhZGEnO30pLmxlbmd0aDsKICAgIHZhciBsYW56PXBTaG90cy5maWx0ZXIoZnVuY3Rpb24ocyl7cmV0dXJuIHMucmVzdWx0IT09J2Z1ZXJhJyYmIXMubm9Hazt9KS5sZW5ndGg7CiAgICB2YXIgcGN0PWxhbno+MD9NYXRoLnJvdW5kKGdvbHMvbGFueioxMDApOjA7CiAgICBodG1sKz0nPGRpdiBjbGFzcz1pdGVtPic7CiAgICBodG1sKz0nPGRpdj48ZGl2IHN0eWxlPSJmb250LXdlaWdodDo2MDAiPnZzICcrX2VIKHJkLnJpdmFsKSsnPC9kaXY+PGRpdiBjbGFzcz1kYXRlPicrZCsnPC9kaXY+PC9kaXY+JzsKICAgIGh0bWwrPSc8ZGl2IGNsYXNzPXN0YXRzPicrcFNob3RzLmxlbmd0aCsnIGxhbnogJm5ic3A7wrcmbmJzcDsgJytwYXJzKycgcGFyICZuYnNwO8K3Jm5ic3A7ICcrZ29scysnIGdvbDxicj4nOwogICAgaHRtbCs9JzxzcGFuIHN0eWxlPSJjb2xvcjonKyhwY3Q+PTMwPycjMjJjNTVlJzpwY3Q+PTIwPycjZmI5MjNjJzonI2VmNDQ0NCcpKyciPicrcGN0KyclIGVmaWMuPC9zcGFuPic7CiAgICBpZihtLmZpbGVJZClodG1sKz0nPGJ1dHRvbiBjbGFzcz1idG4gb25jbGljaz0iZ29NYXRjaChcJycrbS5maWxlSWQrJ1wnKSIgPvCfk4IgSXI8L2J1dHRvbj4nOwogICAgaHRtbCs9JzwvZGl2PjwvZGl2Pic7CiAgfSk7CiAgaHRtbCs9JzxzY3JpcHQ+ZnVuY3Rpb24gZ29NYXRjaChmaWQpeyc7CiAgaHRtbCs9JyAgdHJ5e3ZhciBwPXdpbmRvdy5wYXJlbnQmJndpbmRvdy5wYXJlbnQucGFyZW50P3dpbmRvdy5wYXJlbnQucGFyZW50OndpbmRvdy5wYXJlbnQ7JzsKICBodG1sKz0nICB2YXIgZm49KHAmJnAub3Blbk1hdGNoRnJvbVJpdmFscyk/cC5vcGVuTWF0Y2hGcm9tUml2YWxzOih3aW5kb3cub3BlbmVyJiZ3aW5kb3cub3BlbmVyLm9wZW5NYXRjaEZyb21SaXZhbHM/d2luZG93Lm9wZW5lci5vcGVuTWF0Y2hGcm9tUml2YWxzOm51bGwpOyc7CiAgaHRtbCs9JyAgaWYoZm4pe2ZuKGZpZCk7fWVsc2V7YWxlcnQoIkFicmUgZGVzZGUgZWwgZGlyZWN0b3Jpby4iKTt9JysKICAnICB9Y2F0Y2goZXgpe2FsZXJ0KCJFcnJvcjogIitleC5tZXNzYWdlKTt9JysKICAnfTxcL3NjcmlwdD48L2JvZHk+PC9odG1sPic7CiAgLy8gT3BlbiBhcyBpZnJhbWUgb3ZlcmxheQogIHZhciBvdj1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTsKICBvdi5zdHlsZS5jc3NUZXh0PSdwb3NpdGlvbjpmaXhlZDt0b3A6MDtsZWZ0OjA7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTt6LWluZGV4Ojk5OTk7YmFja2dyb3VuZDojMGExNjI4O2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW4nOwogIHZhciBjYj1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCdidXR0b24nKTsKICBjYi50ZXh0Q29udGVudD0n4pyVIENlcnJhcic7CiAgY2Iuc3R5bGUuY3NzVGV4dD0nYmFja2dyb3VuZDojMWUyOTNiO2NvbG9yOiM5NGEzYjg7Ym9yZGVyOm5vbmU7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuMSk7cGFkZGluZzo4cHggMTZweDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTNweDt0ZXh0LWFsaWduOmxlZnQnOwogIGNiLm9uY2xpY2s9ZnVuY3Rpb24oKXtvdi5yZW1vdmUoKTt9OwogIHZhciBpZnI9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaWZyYW1lJyk7CiAgaWZyLnN0eWxlLmNzc1RleHQ9J2ZsZXg6MTtib3JkZXI6bm9uZTt3aWR0aDoxMDAlO2hlaWdodDoxMDAlJzsKICBpZnIuc3JjZG9jPWh0bWw7CiAgb3YuYXBwZW5kQ2hpbGQoY2IpO292LmFwcGVuZENoaWxkKGlmcik7CiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChvdik7Cn0KZnVuY3Rpb24gZEYoc2gpewogIHZhciBjdj1kb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnZmMnKTsKICBpZighY3YpcmV0dXJuOwogIC8vIEhpRFBJIC8gcmVzb2x1dGlvbiBmaXgKICB2YXIgZHByPXdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvfHwxOwogIHZhciBkaXNwbGF5Vz1jdi5vZmZzZXRXaWR0aHx8MzgwOwogIHZhciBkaXNwbGF5SD1NYXRoLnJvdW5kKGRpc3BsYXlXKjAuNzIpOyAvLyB+cmF0aW8gb2YgZmllbGQKICBjdi53aWR0aD1kaXNwbGF5VypkcHI7CiAgY3YuaGVpZ2h0PWRpc3BsYXlIKmRwcjsKICBjdi5zdHlsZS53aWR0aD1kaXNwbGF5VysncHgnOwogIGN2LnN0eWxlLmhlaWdodD1kaXNwbGF5SCsncHgnOwogIHZhciBjdHg9Y3YuZ2V0Q29udGV4dCgnMmQnKTsKICBjdHguc2NhbGUoZHByLGRwcik7CiAgdmFyIFc9ZGlzcGxheVcsSD1kaXNwbGF5SCxQQUQ9NixDWT0zMTU7CiAgZnVuY3Rpb24gc3goeCl7cmV0dXJuIFBBRCt4KihXLVBBRCoyKS80MjA7fQogIGZ1bmN0aW9uIHN5KHkpe3JldHVybiBQQUQreSooSC1QQUQqMikvQ1k7fQogIGN0eC5jbGVhclJlY3QoMCwwLFcsSCk7CiAgY3R4LmZpbGxTdHlsZT0nIzViOWJkNSc7Y3R4LmZpbGxSZWN0KDAsMCxXLEgpOwogIGN0eC5iZWdpblBhdGgoKTtjdHgubW92ZVRvKHN4KDY5KSxzeSg1KSk7Y3R4LmJlemllckN1cnZlVG8oc3goNjkpLHN5KDk3KSxzeCgzNTEpLHN5KDk3KSxzeCgzNTEpLHN5KDUpKTsKICBjdHguY2xvc2VQYXRoKCk7Y3R4LmZpbGxTdHlsZT0nIzFhNGE4YSc7Y3R4LmZpbGwoKTsKICBjdHguc3Ryb2tlU3R5bGU9J3JnYmEoMjU1LDI1NSwyNTUsLjkyKSc7Y3R4LmxpbmVXaWR0aD0xLjU7Y3R4LnN0cm9rZSgpOwogIGN0eC5iZWdpblBhdGgoKTtjdHgubW92ZVRvKHN4KDUpLHN5KDUpKTtjdHguYmV6aWVyQ3VydmVUbyhzeCg1KSxzeSgxNTgpLHN4KDQxNSksc3koMTU4KSxzeCg0MTUpLHN5KDUpKTsKICBjdHguc2V0TGluZURhc2goWzYsNF0pO2N0eC5zdHJva2VTdHlsZT0ncmdiYSgyNTUsMjU1LDI1NSwuNiknO2N0eC5saW5lV2lkdGg9MTtjdHguc3Ryb2tlKCk7Y3R4LnNldExpbmVEYXNoKFtdKTsKICBjdHguc3Ryb2tlU3R5bGU9J3JnYmEoMjU1LDI1NSwyNTUsLjgpJztjdHgubGluZVdpZHRoPTEuNTsKICBjdHguc3Ryb2tlUmVjdChzeCg1KSxzeSg1KSxzeCg0MTUpLXN4KDUpLHN5KENZLTUpLXN5KDApKTsKICB2YXIgYng9c3goMTU5KSxidz1zeCgyNjEpLXN4KDE1OSksYmg9TWF0aC5tYXgoNCxzeSg4KS1zeSgwKSk7CiAgZm9yKHZhciBzaT0wO3NpPDEwO3NpKyspe2N0eC5maWxsU3R5bGU9c2klMj09PTA/JyNkYzI2MjYnOicjZjBmMGYwJztjdHguZmlsbFJlY3QoYngrc2kvMTAqYncsc3koMCksYncvMTArMC41LGJoKTt9CiAgdmFyIHB3PU1hdGgubWF4KDQsc3goMTY0KS1zeCgxNTYpKSxwaD1zeSgyNCktc3koMCk7CiAgZm9yKHZhciBwaT0wO3BpPDU7cGkrKyl7CiAgICBjdHguZmlsbFN0eWxlPXBpJTI9PT0wPycjZGMyNjI2JzonI2YwZjBmMCc7CiAgICBjdHguZmlsbFJlY3Qoc3goMTU2KSxzeSgwKStwaS81KnBoLHB3LHBoLzUrMC41KTsKICAgIGN0eC5maWxsUmVjdChzeCgyNTYpLHN5KDApK3BpLzUqcGgscHcscGgvNSswLjUpOwogIH0KICB2YXIgWkM9eydFeHRyZW1vIGl6cSc6W3N4KDIzKSxzeSgxNCldLCdFeHRyZW1vIGRlcic6W3N4KDM5Nyksc3koMTQpXSwnNm0gaXpxJzpbc3goMTA3KSxzeSg4MCldLCc2bSBjZW50Jzpbc3goMjEwKSxzeSg4MCldLCc2bSBkZXInOltzeCgzMTMpLHN5KDgwKV0sJ0xhdGVyYWwgaXpxJzpbc3goNTkpLHN5KDE0MCldLCdDZW50cmFsJzpbc3goMjEwKSxzeSgxNDApXSwnTGF0ZXJhbCBkZXInOltzeCgzNjEpLHN5KDE0MCldLCc3IG1ldHJvcyc6W3N4KDEzNCksc3koMjE4KV0sJ0NvbnRyYWF0YXF1ZSc6W3N4KDI4NSksc3koMjE4KV19OwogIHZhciBaTD17J0V4dHJlbW8gaXpxJzonRUknLCdFeHRyZW1vIGRlcic6J0VEJywnNm0gaXpxJzonNm1JJywnNm0gY2VudCc6JzZtQycsJzZtIGRlcic6JzZtRCcsJ0xhdGVyYWwgaXpxJzonTEknLCdDZW50cmFsJzonQ0UnLCdMYXRlcmFsIGRlcic6J0xEJywnNyBtZXRyb3MnOic3TScsJ0NvbnRyYWF0YXF1ZSc6J0NUUSd9OwogIHZhciB6b25lcz1PYmplY3Qua2V5cyhaQyksdEw9MCx6Uz17fTsKICB6b25lcy5mb3JFYWNoKGZ1bmN0aW9uKHopewogICAgdmFyIHN6PXNoLmZpbHRlcihmdW5jdGlvbihzKXtyZXR1cm4gcy56b25lPT09ejt9KTsKICAgIHZhciBnPXN6LmZpbHRlcihmdW5jdGlvbihzKXtyZXR1cm4gcy5yZXN1bHQ9PT0nZ29sJ3x8cy5yZXN1bHQ9PT0nc2lucG9ydGVybyc7fSkubGVuZ3RoOwogICAgdmFyIHA9c3ouZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLnJlc3VsdD09PSdwYXJhZGEnO30pLmxlbmd0aDsKICAgIHZhciBsPXN6LmZpbHRlcihmdW5jdGlvbihzKXtyZXR1cm4gcy5yZXN1bHQhPT0nZnVlcmEnO30pLmxlbmd0aDsKICAgIHpTW3pdPXtnb2w6ZyxwYXI6cCxsYW56OmwscGN0Omw+MD9wL2w6MH07dEwrPWw7CiAgfSk7CiAgdmFyIFJNPU1hdGgubWluKFcsSCkqMC4xMSxSbT00OwogIHpvbmVzLmZvckVhY2goZnVuY3Rpb24oeil7CiAgICB2YXIgcz16U1t6XTtpZighcy5sYW56KXJldHVybjsKICAgIHZhciBjeD1aQ1t6XVswXSxjeT1aQ1t6XVsxXTsKICAgIHZhciByRz10TD4wP01hdGgubWluKFJNLFJtKyhzLmdvbC90TCkqKFJNLVJtKSozLjUpOjA7CiAgICB2YXIgclA9dEw+MD9NYXRoLm1pbihSTSxSbSsocy5wYXIvdEwpKihSTS1SbSkqMy41KTowOwogICAgdmFyIHJQY3Q9TWF0aC5taW4oUk0sUm0rcy5wY3QqKFJNLVJtKSk7CiAgICB2YXIgY3M9WwogICAgICB7cjpyRyxjb2w6JyNlZjQ0NDQnLGZpbGw6J3JnYmEoMjM5LDY4LDY4LC44NSknLHY6cy5nb2wsbGJsOnMuZ29sPjA/Jycrcy5nb2w6bnVsbH0sCiAgICAgIHtyOnJQLGNvbDonIzIyYzU1ZScsZmlsbDoncmdiYSgzNCwxOTcsOTQsLjg1KScsdjpzLnBhcixsYmw6cy5wYXI+MD8nJytzLnBhcjpudWxsfSwKICAgICAge3I6clBjdCxjb2w6JyMzYjgyZjYnLGZpbGw6J3JnYmEoNTksMTMwLDI0NiwuODUpJyx2OnMucGN0LGxibDpzLmxhbno+MD9NYXRoLnJvdW5kKHMucGN0KjEwMCkrJyUnOm51bGx9CiAgICBdLmZpbHRlcihmdW5jdGlvbihjKXtyZXR1cm4gYy52PjAmJmMucj49Um07fSkuc29ydChmdW5jdGlvbihhLGIpe3JldHVybiBiLnItYS5yO30pOwogICAgY3MuZm9yRWFjaChmdW5jdGlvbihjKXsKICAgICAgY3R4LnNhdmUoKTtjdHguYmVnaW5QYXRoKCk7Y3R4LmFyYyhjeCxjeSxjLnIsMCwyKk1hdGguUEkpOwogICAgICBjdHguZmlsbFN0eWxlPWMuZmlsbDtjdHguZmlsbCgpO2N0eC5zdHJva2VTdHlsZT1jLmNvbDtjdHgubGluZVdpZHRoPTEuNTtjdHguc3Ryb2tlKCk7Y3R4LnJlc3RvcmUoKTsKICAgIH0pOwogICAgaWYoY3MubGVuZ3RoKXsKICAgICAgdmFyIHRvcD1jc1tjcy5sZW5ndGgtMV07CiAgICAgIGlmKHRvcC5sYmwpewogICAgICAgIGN0eC5zYXZlKCk7Y3R4LmZvbnQ9J2JvbGQgJytNYXRoLm1heCg5LE1hdGgucm91bmQoY3NbMF0uciowLjc1KSkrJ3B4IERNIFNhbnMsc2Fucy1zZXJpZic7CiAgICAgICAgY3R4LmZpbGxTdHlsZT0nI2ZmZic7Y3R4LnRleHRBbGlnbj0nY2VudGVyJztjdHgudGV4dEJhc2VsaW5lPSdtaWRkbGUnOwogICAgICAgIGN0eC5zaGFkb3dDb2xvcj0ncmdiYSgwLDAsMCwuOCknO2N0eC5zaGFkb3dCbHVyPTM7Y3R4LmZpbGxUZXh0KHRvcC5sYmwsY3gsY3kpO2N0eC5yZXN0b3JlKCk7CiAgICAgIH0KICAgIH0KICAgIC8vIFpvbmUgbGFiZWwgLSBjcmlzcCB0aGFua3MgdG8gRFBSIHNjYWxpbmcKICAgIGN0eC5zYXZlKCk7Y3R4LmZvbnQ9J2JvbGQgOXB4IERNIFNhbnMsc2Fucy1zZXJpZic7Y3R4LmZpbGxTdHlsZT0ncmdiYSgyNTUsMjU1LDI1NSwuOTUpJzsKICAgIGN0eC50ZXh0QWxpZ249J2NlbnRlcic7Y3R4LnRleHRCYXNlbGluZT0ndG9wJzsKICAgIGN0eC5zaGFkb3dDb2xvcj0ncmdiYSgwLDAsMCwuOTUpJztjdHguc2hhZG93Qmx1cj0yOwogICAgY3R4LmZpbGxUZXh0KFpMW3pdLGN4LGN5K1JNLTcpO2N0eC5yZXN0b3JlKCk7CiAgfSk7Cn0KZnVuY3Rpb24gZEcoc2gpewogIHZhciBzdmdFbDI9ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2dzJyk7CiAgaWYoc3ZnRWwyJiYhc3ZnRWwyLmdldEF0dHJpYnV0ZSgndmlld0JveCcpKXN2Z0VsMi5zZXRBdHRyaWJ1dGUoJ3ZpZXdCb3gnLCcwIDAgNDIwIDI0NScpOwogIC8vIEZJWDogc2V0IGlubmVySFRNTCBvbiB0aGUgU1ZHIGVsZW1lbnQgZGlyZWN0bHksIG5vdCBvbiB0aGUgPGc+IGNoaWxkCiAgLy8gVGhpcyBlbnN1cmVzIHByb3BlciBTVkcgbmFtZXNwYWNlIHBhcnNpbmcKICB2YXIgc3ZnRWw9ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2dzJyk7CiAgaWYoIXN2Z0VsKXJldHVybjsKICAvLyBSZWJ1aWxkIHN0YXRpYyBTVkcgc3RydWN0dXJlICsgZHluYW1pYyBjZWxscwogIHZhciBjZWxscz1bCiAgICB7cG9zOidBbHRvIGl6cScseDozNCx5OjI4LHc6MTE0LGg6NjV9LAogICAge3BvczonQWx0byBjZW50cm8nLHg6MTUyLHk6MjgsdzoxMTYsaDo2NX0sCiAgICB7cG9zOidBbHRvIGRlcicseDoyNzIseToyOCx3OjExNCxoOjY1fSwKICAgIHtwb3M6J01lZGlvIGl6cScseDozNCx5Ojk3LHc6MTE0LGg6NjN9LAogICAge3BvczonQ2VudHJvJyx4OjE1Mix5Ojk3LHc6MTE2LGg6NjN9LAogICAge3BvczonTWVkaW8gZGVyJyx4OjI3Mix5Ojk3LHc6MTE0LGg6NjN9LAogICAge3BvczonQmFqbyBpenEnLHg6MzQseToxNjQsdzoxMTQsaDo1OH0sCiAgICB7cG9zOidCYWpvIGNlbnRybycseDoxNTIseToxNjQsdzoxMTYsaDo1OH0sCiAgICB7cG9zOidCYWpvIGRlcicseDoyNzIseToxNjQsdzoxMTQsaDo1OH0KICBdOwogIHZhciBkeW5hbWljPScnOwogIGNlbGxzLmZvckVhY2goZnVuY3Rpb24oYyl7CiAgICB2YXIgc3o9c2guZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLmdvYWxQb3M9PT1jLnBvczt9KTsKICAgIHZhciBnb2w9c3ouZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLnJlc3VsdD09PSdnb2wnfHxzLnJlc3VsdD09PSdzaW5wb3J0ZXJvJzt9KS5sZW5ndGg7CiAgICB2YXIgbHo9c3ouZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLnJlc3VsdCE9PSdmdWVyYSc7fSkubGVuZ3RoOwogICAgdmFyIHBwPWx6PjA/TWF0aC5yb3VuZChnb2wvbHoqMTAwKTpudWxsOwogICAgdmFyIHRjPXBBKHBwKTsKICAgIHZhciBmaWxsPXBwPT09bnVsbD8ncmdiYSgyNTUsMjU1LDI1NSwuMDQpJzp0YysnMzMnOwogICAgZHluYW1pYys9JzxyZWN0IHg9IicrYy54KyciIHk9IicrYy55KyciIHdpZHRoPSInK2MudysnIiBoZWlnaHQ9IicrYy5oKyciIGZpbGw9IicrZmlsbCsnIiByeD0iMyIvPic7CiAgICBpZihsej4wKXsKICAgICAgZHluYW1pYys9Jzx0ZXh0IHg9IicrKGMueCtjLncvMikrJyIgeT0iJysoYy55K2MuaC8yLTYpKyciIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IicrdGMrJyIgZm9udC1zaXplPSIxNCIgZm9udC13ZWlnaHQ9IjcwMCI+Jytnb2wrJy8nK2x6Kyc8L3RleHQ+JzsKICAgICAgZHluYW1pYys9Jzx0ZXh0IHg9IicrKGMueCtjLncvMikrJyIgeT0iJysoYy55K2MuaC8yKzEzKSsnIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSInK3RjKyciIGZvbnQtc2l6ZT0iMTEiPicrKHBwIT09bnVsbD9wcCsnJSBnb2wnOictLScpKyc8L3RleHQ+JzsKICAgIH0KICB9KTsKICAvLyBTZXR0aW5nIGlubmVySFRNTCBvbiB0aGUgU1ZHIGVsZW1lbnQgaXRzZWxmIGVuc3VyZXMgU1ZHIG5hbWVzcGFjZQogIHN2Z0VsLmlubmVySFRNTD0nPGRlZnM+JysKICAgICc8cGF0dGVybiBpZD0ibmdSIiB4PSIwIiB5PSIwIiB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiPjxsaW5lIHgxPSIwIiB5MT0iMCIgeDI9IjIwIiB5Mj0iMjAiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwuMDkpIiBzdHJva2Utd2lkdGg9Ii45Ii8+PGxpbmUgeDE9IjIwIiB5MT0iMCIgeDI9IjAiIHkyPSIyMCIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LC4wOSkiIHN0cm9rZS13aWR0aD0iLjkiLz48L3BhdHRlcm4+JysKICAgICc8cGF0dGVybiBpZD0iaHBSIiB4PSIwIiB5PSIwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjE2IiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjgiIGZpbGw9IiNkYzI2MjYiLz48cmVjdCB5PSI4IiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjgiIGZpbGw9IiNlZmVmZWYiLz48L3BhdHRlcm4+JysKICAgICc8cGF0dGVybiBpZD0iaGJSIiB4PSIwIiB5PSIwIiB3aWR0aD0iMjAiIGhlaWdodD0iMTAwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cmVjdCB3aWR0aD0iMTAiIGhlaWdodD0iMTAwIiBmaWxsPSIjZGMyNjI2Ii8+PHJlY3QgeD0iMTAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiNlZmVmZWYiLz48L3BhdHRlcm4+JysKICAgICc8L2RlZnM+JysKICAgICc8cmVjdCB3aWR0aD0iNDIwIiBoZWlnaHQ9IjI0NSIgZmlsbD0iIzA5MTUyNCIgcng9IjgiLz4nKwogICAgJzxyZWN0IHg9IjMwIiB5PSIyMCIgd2lkdGg9IjM2MCIgaGVpZ2h0PSIyMDAiIGZpbGw9InVybCgjbmdSKSIvPicrCiAgICAnPHJlY3QgeD0iMjAiIHk9IjEyIiB3aWR0aD0iMzgwIiBoZWlnaHQ9IjIwNSIgcng9IjUiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgwLDAsMCwuNzUpIiBzdHJva2Utd2lkdGg9IjE2Ii8+JysKICAgICc8cmVjdCB4PSIyNCIgeT0iMTYiIHdpZHRoPSIzNzIiIGhlaWdodD0iMTk2IiByeD0iMyIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSI1Ii8+JysKICAgICc8cmVjdCB4PSIxMiIgeT0iMTIiIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMDUiIGZpbGw9InVybCgjaHBSKSIgcng9IjMiLz4nKwogICAgJzxyZWN0IHg9IjM4NiIgeT0iMTIiIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMDUiIGZpbGw9InVybCgjaHBSKSIgcng9IjMiLz4nKwogICAgJzxyZWN0IHg9IjEyIiB5PSIxMiIgd2lkdGg9IjM5NiIgaGVpZ2h0PSIxNiIgZmlsbD0idXJsKCNoYlIpIiByeD0iMyIvPicrCiAgICAnPGxpbmUgeDE9IjE1MCIgeTE9IjI4IiB4Mj0iMTUwIiB5Mj0iMjA4IiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsLjMpIiBzdHJva2Utd2lkdGg9IjEuNSIvPicrCiAgICAnPGxpbmUgeDE9IjI3MCIgeTE9IjI4IiB4Mj0iMjcwIiB5Mj0iMjA4IiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsLjMpIiBzdHJva2Utd2lkdGg9IjEuNSIvPicrCiAgICAnPGxpbmUgeDE9IjM0IiB5MT0iOTUiIHgyPSIzODYiIHkyPSI5NSIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LC4zKSIgc3Ryb2tlLXdpZHRoPSIxLjUiLz4nKwogICAgJzxsaW5lIHgxPSIzNCIgeTE9IjE2MiIgeDI9IjM4NiIgeTI9IjE2MiIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LC4zKSIgc3Ryb2tlLXdpZHRoPSIxLjUiLz4nKwogICAgZHluYW1pYzsKfQp3aW5kb3cub25sb2FkPWZ1bmN0aW9uKCl7aW5pdCgpO307Cg==";var scr="var RD="+RD_STR+";"+decodeURIComponent(escape(atob(CODE_B64)));scr+=";var JUMP_TO="+JSON.stringify(jumpTo||null)+";window.addEventListener(\'load\',function(){if(!JUMP_TO)return;try{var idx=RD.findIndex(function(rd){return rd.rival.trim().toLowerCase()===JUMP_TO.rival.trim().toLowerCase();});if(idx<0)return;oR(idx);oP(JUMP_TO.player);}catch(e){}});";scr+=\'var _NF="ZnVuY3Rpb24gX2F0dGFja2VyTmFtZShhdHRhY2tlcil7CiAgdmFyIHM9KGF0dGFja2VyfHwiIikudHJpbSgpOyBpZighc3x8cz09PSItLSIpIHJldHVybiAiRGVzY29ub2NpZGEiOwogIHZhciBtPXMubWF0Y2goL15cUytccysoLispJC8pOwogIHJldHVybiAobT9tWzFdOnMpLnRyaW0oKTsKfQpmdW5jdGlvbiBvUihpKXsKICBjUj1pO3ZhciByZD1SRFtpXTsKICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgicmgiKS50ZXh0Q29udGVudD1yZC5yaXZhbDsKICB2YXIgbWF0Y2hCdG49ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInJpdmFsLW1hdGNoZXMtYnRuIik7CiAgaWYobWF0Y2hCdG4pe21hdGNoQnRuLnN0eWxlLmRpc3BsYXk9ImlubGluZS1mbGV4IjttYXRjaEJ0bi5vbmNsaWNrPWZ1bmN0aW9uKCl7b3BlblJpdmFsTWF0Y2hlcyhpKTt9O30KICB2YXIgZWw9ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInBsIik7ZWwuaW5uZXJIVE1MPSIiOwogIHZhciBhbUtleT17fTt2YXIgYW1TaG90cz17fTsKICByZC5tYXRjaGVzLmZvckVhY2goZnVuY3Rpb24obSl7KG0uc2hvdHN8fFtdKS5mb3JFYWNoKGZ1bmN0aW9uKHMpewogICAgdmFyIG49KHMuYXR0YWNrZXJ8fCIiKS50cmltKCk7aWYoIW58fG49PT0iLS0iKW49IkRlc2Nvbm9jaWRhIjsKICAgIHZhciBrZXk9X2F0dGFja2VyTmFtZShzLmF0dGFja2VyKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1xzKy9nLCIgIik7CiAgICBpZighYW1LZXlba2V5XSl7YW1LZXlba2V5XT1uO2FtU2hvdHNba2V5XT1bXTt9CiAgICBhbVNob3RzW2tleV0ucHVzaChzKTsKICB9KTt9KTsKICB2YXIga2V5cz1PYmplY3Qua2V5cyhhbUtleSkuc29ydChmdW5jdGlvbihhLGIpewogICAgdmFyIGRhPXBhcnNlSW50KGFtS2V5W2FdKXx8OTk5LGRiPXBhcnNlSW50KGFtS2V5W2JdKXx8OTk5OwogICAgcmV0dXJuIGRhIT09ZGI/ZGEtZGI6YW1LZXlbYV0ubG9jYWxlQ29tcGFyZShhbUtleVtiXSwiZXMiKTsKICB9KTsKICBpZigha2V5cy5sZW5ndGgpe2VsLmlubmVySFRNTD0iPGRpdiBzdHlsZT1cImNvbG9yOiM2NDc0OGI7cGFkZGluZzoyMHB4XCI+U2luIGxhbnphbWllbnRvcyByZWdpc3RyYWRvczwvZGl2PiI7cmV0dXJuO30KICBrZXlzLmZvckVhY2goZnVuY3Rpb24oa2V5KXsKICAgIHZhciBuYW1lPWFtS2V5W2tleV07dmFyIHNob3RzPWFtU2hvdHNba2V5XTsKICAgIHZhciBnb2w9c2hvdHMuZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLnJlc3VsdD09PSJnb2wifHxzLnJlc3VsdD09PSJzaW5wb3J0ZXJvIjt9KS5sZW5ndGg7CiAgICB2YXIgcGFyPXNob3RzLmZpbHRlcihmdW5jdGlvbihzKXtyZXR1cm4gcy5yZXN1bHQ9PT0icGFyYWRhIjt9KS5sZW5ndGg7CiAgICB2YXIgbGFuej1zaG90cy5maWx0ZXIoZnVuY3Rpb24ocyl7cmV0dXJuIHMucmVzdWx0IT09ImZ1ZXJhIjt9KS5sZW5ndGg7CiAgICB2YXIgcGN0PWxhbno+MD9NYXRoLnJvdW5kKGdvbC9sYW56KjEwMCk6bnVsbDsKICAgIHZhciBkPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImRpdiIpO2QuY2xhc3NOYW1lPSJjZCI7CiAgICBkLmlubmVySFRNTD0iPGRpdiBjbGFzcz1jdD4iK25hbWUrIjwvZGl2PjxkaXYgY2xhc3M9Y20+IitzaG90cy5sZW5ndGgrIiBsYW56LiAmbWlkZG90OyAiK2dvbCsiIGdvbCIrKGdvbCE9PTE/ImVzIjoiIikrIiAmbWlkZG90OyAiK3BhcisiIHBhcmFkYSIrKHBhciE9PTE/InMiOiIiKSsocGN0IT09bnVsbD8iICZtaWRkb3Q7IDxzcGFuIHN0eWxlPVwiY29sb3I6IitwQyhwY3QpKyJcIj4iK3BjdCsiJSBlZmljLjwvc3Bhbj4iOiIiKSsiIDwvZGl2PiI7CiAgICBkLm9uY2xpY2s9KGZ1bmN0aW9uKGspe3JldHVybiBmdW5jdGlvbigpe29QKGFtS2V5W2tdLGFtU2hvdHNba10pO307fSkoa2V5KTsKICAgIGVsLmFwcGVuZENoaWxkKGQpOwogIH0pOwogIHNob3coInBsYXllcnMiKTsKfQpmdW5jdGlvbiBvUChuYW1lLCBwcmVTaG90cyl7CiAgdmFyIHJkPVJEW2NSXTsKICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgicmVoIikudGV4dENvbnRlbnQ9cmQucml2YWw7CiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInBuaCIpLnRleHRDb250ZW50PW5hbWU7CiAgY3VyUGZQZEZpbHRlcj1udWxsOwogIGlmKHByZVNob3RzKXsKICAgIGN1clBsYXllclNob3RzPXByZVNob3RzOwogIH0gZWxzZSB7CiAgICBjdXJQbGF5ZXJTaG90cz1bXTsKICAgIHZhciBub3JtTj1fYXR0YWNrZXJOYW1lKG5hbWUpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXHMrL2csIiAiKTsKICAgIHJkLm1hdGNoZXMuZm9yRWFjaChmdW5jdGlvbihtKXsobS5zaG90c3x8W10pLmZvckVhY2goZnVuY3Rpb24ocyl7CiAgICAgIGlmKF9hdHRhY2tlck5hbWUocy5hdHRhY2tlcikudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9ccysvZywiICIpPT09bm9ybU4pY3VyUGxheWVyU2hvdHMucHVzaChzKTsKICAgIH0pO30pOwogIH0KICB2YXIgblBmPWN1clBsYXllclNob3RzLmZpbHRlcihmdW5jdGlvbihzKXtyZXR1cm4gcy5wZjt9KS5sZW5ndGg7CiAgdmFyIG5QZD1jdXJQbGF5ZXJTaG90cy5maWx0ZXIoZnVuY3Rpb24ocyl7cmV0dXJuIHMucGQ7fSkubGVuZ3RoOwogIHZhciB0b3Q9Y3VyUGxheWVyU2hvdHMubGVuZ3RoOwogIHZhciBwY3RQZj10b3Q+MD9NYXRoLnJvdW5kKG5QZi90b3QqMTAwKTowOwogIHZhciBwY3RQZD10b3Q+MD9NYXRoLnJvdW5kKG5QZC90b3QqMTAwKTowOwogIHZhciBwZlBkRGl2PWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJwZi1wZC1maWx0ZXIiKTsKICBpZihwZlBkRGl2KXsKICAgIHBmUGREaXYuaW5uZXJIVE1MPSIiOwogICAgaWYoblBmPjB8fG5QZD4wKXsKICAgICAgcGZQZERpdi5zdHlsZS5kaXNwbGF5PSJmbGV4IjsKICAgICAgaWYoblBmPjApewogICAgICAgIHZhciBicGY9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgiYnV0dG9uIik7CiAgICAgICAgYnBmLmlkPSJmcC1wZiI7CiAgICAgICAgYnBmLm9uY2xpY2s9ZnVuY3Rpb24oKXtzZXRQZlBkRmlsdGVyKCJwZiIsdGhpcyk7fTsKICAgICAgICBicGYuc3R5bGUuY3NzVGV4dD0iZmxleDoxO3BhZGRpbmc6MTBweCAxMnB4O2JvcmRlci1yYWRpdXM6MTBweDtib3JkZXI6MnB4IHNvbGlkIHJnYmEoMzQsMTk3LDk0LC4zKTtiYWNrZ3JvdW5kOnJnYmEoMjU1LDI1NSwyNTUsLjA1KTtjb2xvcjojODZlZmFjO2ZvbnQtZmFtaWx5OkRNIFNhbnMsc2Fucy1zZXJpZjtjdXJzb3I6cG9pbnRlcjt0cmFuc2l0aW9uOmFsbCAuMTVzO3RleHQtYWxpZ246Y2VudGVyIjsKICAgICAgICBicGYuaW5uZXJIVE1MPSI8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjExcHg7Y29sb3I6IzY0NzQ4Yjt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7bGV0dGVyLXNwYWNpbmc6LjhweDttYXJnaW4tYm90dG9tOjJweFwiPlB1bnRvIEZ1ZXJ0ZTwvZGl2PjxkaXYgc3R5bGU9XCJmb250LWZhbWlseTpCZWJhcyBOZXVlLHNhbnMtc2VyaWY7Zm9udC1zaXplOjI4cHg7bGluZS1oZWlnaHQ6MTtjb2xvcjojMjJjNTVlXCI+IituUGYrIjwvZGl2PjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjojNjQ3NDhiO21hcmdpbi10b3A6MnB4XCI+IitwY3RQZisiJSBkZWwgdG90YWw8L2Rpdj4iOwogICAgICAgIHBmUGREaXYuYXBwZW5kQ2hpbGQoYnBmKTsKICAgICAgfQogICAgICBpZihuUGQ+MCl7CiAgICAgICAgdmFyIGJwZD1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCJidXR0b24iKTsKICAgICAgICBicGQuaWQ9ImZwLXBkIjsKICAgICAgICBicGQub25jbGljaz1mdW5jdGlvbigpe3NldFBmUGRGaWx0ZXIoInBkIix0aGlzKTt9OwogICAgICAgIGJwZC5zdHlsZS5jc3NUZXh0PSJmbGV4OjE7cGFkZGluZzoxMHB4IDEycHg7Ym9yZGVyLXJhZGl1czoxMHB4O2JvcmRlcjoycHggc29saWQgcmdiYSgyMzksNjgsNjgsLjMpO2JhY2tncm91bmQ6cmdiYSgyNTUsMjU1LDI1NSwuMDUpO2NvbG9yOiNmY2E1YTU7Zm9udC1mYW1pbHk6RE0gU2FucyxzYW5zLXNlcmlmO2N1cnNvcjpwb2ludGVyO3RyYW5zaXRpb246YWxsIC4xNXM7dGV4dC1hbGlnbjpjZW50ZXIiOwogICAgICAgIGJwZC5pbm5lckhUTUw9IjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjojNjQ3NDhiO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouOHB4O21hcmdpbi1ib3R0b206MnB4XCI+UHVudG8gRMOpYmlsPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtZmFtaWx5OkJlYmFzIE5ldWUsc2Fucy1zZXJpZjtmb250LXNpemU6MjhweDtsaW5lLWhlaWdodDoxO2NvbG9yOiNlZjQ0NDRcIj4iK25QZCsiPC9kaXY+PGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOiM2NDc0OGI7bWFyZ2luLXRvcDoycHhcIj4iK3BjdFBkKyIlIGRlbCB0b3RhbDwvZGl2PiI7CiAgICAgICAgcGZQZERpdi5hcHBlbmRDaGlsZChicGQpOwogICAgICB9CiAgICB9IGVsc2UgewogICAgICBwZlBkRGl2LnN0eWxlLmRpc3BsYXk9Im5vbmUiOwogICAgfQogIH0KICB2YXIgYnRuQmFyPWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJwbGF5ZXItYnRuLWJhciIpOwogIGlmKCFidG5CYXIpewogICAgYnRuQmFyPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImRpdiIpOwogICAgYnRuQmFyLmlkPSJwbGF5ZXItYnRuLWJhciI7CiAgICBidG5CYXIuc3R5bGUuY3NzVGV4dD0iZGlzcGxheTpmbGV4O2p1c3RpZnktY29udGVudDpmbGV4LWVuZDtnYXA6MTJweDttYXJnaW4tYm90dG9tOjE2cHg7ZmxleC13cmFwOndyYXAiOwogICAgdmFyIG1hdGNoZXNCdG49ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgiYnV0dG9uIik7CiAgICBtYXRjaGVzQnRuLmlkPSJwbGF5ZXItbWF0Y2hlcy1idG4iOwogICAgbWF0Y2hlc0J0bi5zdHlsZS5jc3NUZXh0PSJwYWRkaW5nOjhweCAxOHB4O2JvcmRlci1yYWRpdXM6OHB4O2JvcmRlcjoxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuMTUpO2JhY2tncm91bmQ6cmdiYSgyNTUsMjU1LDI1NSwuMDgpO2NvbG9yOiM5NGEzYjg7Zm9udC1mYW1pbHk6RE0gU2FucyxzYW5zLXNlcmlmO2ZvbnQtc2l6ZToxM3B4O2N1cnNvcjpwb2ludGVyIjsKICAgIG1hdGNoZXNCdG4udGV4dENvbnRlbnQ9IvCfk4sgSXIgYWwgcGFydGlkbyI7CiAgICB2YXIgcGRmQnRuPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImJ1dHRvbiIpOwogICAgcGRmQnRuLmlkPSJyaXZhbC1wZGYtYnRuIjsKICAgIHBkZkJ0bi5zdHlsZS5jc3NUZXh0PSJwYWRkaW5nOjhweCAxOHB4O2JvcmRlci1yYWRpdXM6OHB4O2JvcmRlcjpub25lO2JhY2tncm91bmQ6bGluZWFyLWdyYWRpZW50KDEzNWRlZywjZGMyNjI2LCNiOTFjMWMpO2NvbG9yOiNmZmY7Zm9udC1mYW1pbHk6RE0gU2FucyxzYW5zLXNlcmlmO2ZvbnQtc2l6ZToxM3B4O2N1cnNvcjpwb2ludGVyIjsKICAgIHBkZkJ0bi50ZXh0Q29udGVudD0i8J+WqO+4jyBFeHBvcnRhciBQREYiOwogICAgcGRmQnRuLm9uY2xpY2s9ZnVuY3Rpb24oKXt3aW5kb3cucHJpbnQoKTt9OwogICAgYnRuQmFyLmFwcGVuZENoaWxkKG1hdGNoZXNCdG4pOwogICAgYnRuQmFyLmFwcGVuZENoaWxkKHBkZkJ0bik7CiAgICB2YXIgcGdyPWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJwZy1yZXBvcnQiKTsKICAgIHZhciByZWY9cGdyLmZpcnN0Q2hpbGQ/cGdyLmZpcnN0Q2hpbGQubmV4dFNpYmxpbmc6bnVsbDsKICAgIHBnci5pbnNlcnRCZWZvcmUoYnRuQmFyLHJlZik7CiAgfQogIHZhciBtYj1kb2N1bWVudC5nZXRFbGVtZW50QnlJZCgicGxheWVyLW1hdGNoZXMtYnRuIik7CiAgaWYobWIpIG1iLm9uY2xpY2s9KGZ1bmN0aW9uKG4scyl7cmV0dXJuIGZ1bmN0aW9uKCl7b3BlblBsYXllck1hdGNoZXMobixzKTt9O30pKG5hbWUsY3VyUGxheWVyU2hvdHMpOwogIHNob3coInJlcG9ydCIpOwogIHNldFRpbWVvdXQoZnVuY3Rpb24oKXsKICAgIHJlbmRlclBsYXllckRhdGEoY3VyUGxheWVyU2hvdHMpOwogICAgdmFyIHBncj1kb2N1bWVudC5nZXRFbGVtZW50QnlJZCgicGctcmVwb3J0Iik7CiAgICB2YXIgb2JzSWQ9Im9icy1wbGF5ZXItYm94IjsKICAgIHZhciBvYnNCb3g9ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQob2JzSWQpOwogICAgaWYoIW9ic0JveCl7CiAgICAgIG9ic0JveD1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCJkaXYiKTsKICAgICAgb2JzQm94LmlkPW9ic0lkOwogICAgICBvYnNCb3guc3R5bGUuY3NzVGV4dD0ibWFyZ2luLXRvcDoyMHB4O3BhZGRpbmctdG9wOjE2cHg7Ym9yZGVyLXRvcDoxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuMDgpO3BhZ2UtYnJlYWstaW5zaWRlOmF2b2lkO2JyZWFrLWluc2lkZTphdm9pZCI7CiAgICAgIG9ic0JveC5pbm5lckhUTUw9IjxkaXYgc3R5bGU9XCJmb250LXNpemU6MTFweDtjb2xvcjojNjQ3NDhiO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtsZXR0ZXItc3BhY2luZzouOHB4O21hcmdpbi1ib3R0b206OHB4XCI+8J+TnSBPYnNlcnZhY2lvbmVzPC9kaXY+IisKICAgICAgICAiPHRleHRhcmVhIGlkPW9icy1wbGF5ZXItdGEgcGxhY2Vob2xkZXI9XCJBw7FhZGUgdHVzIG9ic2VydmFjaW9uZXMgc29icmUgZXN0YSBqdWdhZG9yYS4uLlwiICIrCiAgICAgICAgInN0eWxlPVwid2lkdGg6MTAwJTtib3gtc2l6aW5nOmJvcmRlci1ib3g7YmFja2dyb3VuZDpyZ2JhKDI1NSwyNTUsMjU1LC4wNCk7Ym9yZGVyOjFweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC4xKTsiKwogICAgICAgICJib3JkZXItcmFkaXVzOjhweDtjb2xvcjojY2JkNWUxO2ZvbnQtZmFtaWx5OkRNIFNhbnMsc2Fucy1zZXJpZjtmb250LXNpemU6MTNweDtwYWRkaW5nOjEwcHg7cmVzaXplOnZlcnRpY2FsO21pbi1oZWlnaHQ6ODBweFwiPjwvdGV4dGFyZWE+IjsKICAgICAgcGdyLmFwcGVuZENoaWxkKG9ic0JveCk7CiAgICB9CiAgICB2YXIgcml2YWw9UkRbY1JdP1JEW2NSXS5yaXZhbDoiIjsKICAgIHZhciBvYnNLZXk9Im9ic19wbGF5ZXJfIityaXZhbCsiXyIrbmFtZTsKICAgIHZhciB0YT1kb2N1bWVudC5nZXRFbGVtZW50QnlJZCgib2JzLXBsYXllci10YSIpOwogICAgaWYodGEpewogICAgICB0cnl7dGEudmFsdWU9bG9jYWxTdG9yYWdlLmdldEl0ZW0ob2JzS2V5KXx8IiI7fWNhdGNoKGUpe30KICAgICAgdGEub25pbnB1dD1mdW5jdGlvbigpe3RyeXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbShvYnNLZXksdGhpcy52YWx1ZSk7fWNhdGNoKGUpe307fTsKICAgIH0KICB9LDUwKTsKfQpmdW5jdGlvbiBvcGVuUGxheWVyTWF0Y2hlcyhuYW1lLCBwbGF5ZXJTaG90cyl7CiAgdmFyIHJkPVJEW2NSXTsKICB2YXIgbm9ybU49X2F0dGFja2VyTmFtZShuYW1lKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1xzKy9nLCIgIik7CiAgdmFyIG1hdGNoZXNXaXRoUGxheWVyPVtdOwogIHJkLm1hdGNoZXMuZm9yRWFjaChmdW5jdGlvbihtKXsKICAgIHZhciBoYXM9KG0uc2hvdHN8fFtdKS5zb21lKGZ1bmN0aW9uKHMpewogICAgICByZXR1cm4gX2F0dGFja2VyTmFtZShzLmF0dGFja2VyKS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1xzKy9nLCIgIik9PT1ub3JtTjsKICAgIH0pOwogICAgaWYoaGFzKW1hdGNoZXNXaXRoUGxheWVyLnB1c2gobSk7CiAgfSk7CiAgaWYoIW1hdGNoZXNXaXRoUGxheWVyLmxlbmd0aCl7YWxlcnQoIk5vIGhheSBwYXJ0aWRvcyBjb24gbGFuemFtaWVudG9zIGRlICIrbmFtZSk7cmV0dXJuO30KICB2YXIgaHRtbD0iPCFET0NUWVBFIGh0bWw+PGh0bWw+PGhlYWQ+PG1ldGEgY2hhcnNldD1VVEYtOD4iOwogIGh0bWwrPSI8dGl0bGU+UGFydGlkb3MgZGUgIituYW1lKyI8L3RpdGxlPiI7CiAgaHRtbCs9IjxzdHlsZT5ib2R5e2JhY2tncm91bmQ6IzBhMTYyODtjb2xvcjojY2JkNWUxO2ZvbnQtZmFtaWx5OkRNIFNhbnMsc2Fucy1zZXJpZjtwYWRkaW5nOjIwcHg7bWFyZ2luOjB9IjsKICBodG1sKz0iLmNhcmR7YmFja2dyb3VuZDojMTExZjNhO2JvcmRlci1yYWRpdXM6MTJweDtwYWRkaW5nOjIwcHg7bWFyZ2luLWJvdHRvbToxNnB4fSI7CiAgaHRtbCs9Ii50aXRsZXtmb250LWZhbWlseTpCZWJhcyBOZXVlLHNhbnMtc2VyaWY7Zm9udC1zaXplOjIycHg7Y29sb3I6I2Y1OWUwYjttYXJnaW4tYm90dG9tOjZweH0iOwogIGh0bWwrPSIuc3Vie2ZvbnQtc2l6ZToxM3B4O2NvbG9yOiM2NDc0OGI7bWFyZ2luLWJvdHRvbToxNHB4fSI7CiAgaHRtbCs9Ii5pdGVte2JhY2tncm91bmQ6cmdiYSgyNTUsMjU1LDI1NSwuMDUpO2JvcmRlci1yYWRpdXM6MTBweDtwYWRkaW5nOjE0cHggMThweDttYXJnaW4tYm90dG9tOjhweDtjdXJzb3I6cG9pbnRlcjtib3JkZXI6MXB4IHNvbGlkIHJnYmEoMjU1LDI1NSwyNTUsLjA4KTtkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47YWxpZ24taXRlbXM6Y2VudGVyfSI7CiAgaHRtbCs9Ii5pdGVtOmhvdmVye2JhY2tncm91bmQ6cmdiYSg5OSwxMDIsMjQxLC4xNSk7Ym9yZGVyLWNvbG9yOnJnYmEoOTksMTAyLDI0MSwuNCl9IjsKICBodG1sKz0iLmRhdGV7Zm9udC1zaXplOjEycHg7Y29sb3I6IzY0NzQ4YjttYXJnaW4tdG9wOjNweH0iOwogIGh0bWwrPSIuc3RhdHN7Zm9udC1zaXplOjEycHg7Y29sb3I6Izk0YTNiODt0ZXh0LWFsaWduOnJpZ2h0fSI7CiAgaHRtbCs9Ii5idG57YmFja2dyb3VuZDpsaW5lYXItZ3JhZGllbnQoMTM1ZGVnLCMxYTU2ZGIsIzI1NjNlYik7Y29sb3I6I2ZmZjtib3JkZXI6bm9uZTtib3JkZXItcmFkaXVzOjhweDtwYWRkaW5nOjZweCAxNHB4O2N1cnNvcjpwb2ludGVyO2ZvbnQtc2l6ZToxMnB4O21hcmdpbi1sZWZ0OjhweH0iOwogIGh0bWwrPSI8L3N0eWxlPjwvaGVhZD48Ym9keT4iOwogIGh0bWwrPSI8ZGl2IGNsYXNzPWNhcmQ+IjsKICBodG1sKz0iPGRpdiBjbGFzcz10aXRsZT7wn5OLICIrbmFtZSsiPC9kaXY+IjsKICBodG1sKz0iPGRpdiBjbGFzcz1zdWI+IittYXRjaGVzV2l0aFBsYXllci5sZW5ndGgrIiBwYXJ0aWRvIisobWF0Y2hlc1dpdGhQbGF5ZXIubGVuZ3RoIT09MT8icyI6IiIpKyIgdnMgIityZC5yaXZhbCsiPC9kaXY+IjsKICBodG1sKz0iPGJ1dHRvbiBzdHlsZT1cImJhY2tncm91bmQ6cmdiYSgyNTUsMjU1LDI1NSwuMDgpO2JvcmRlcjoxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuMTUpO2NvbG9yOiM5NGEzYjg7Ym9yZGVyLXJhZGl1czo4cHg7cGFkZGluZzo3cHggMTRweDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTNweFwiIG9uY2xpY2s9XCJ3aW5kb3cuY2xvc2UoKVwiPuKclSBDZXJyYXI8L2J1dHRvbj4iOwogIGh0bWwrPSI8L2Rpdj4iOwogIG1hdGNoZXNXaXRoUGxheWVyLmZvckVhY2goZnVuY3Rpb24obSl7CiAgICB2YXIgcFNob3RzPShtLnNob3RzfHxbXSkuZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBfYXR0YWNrZXJOYW1lKHMuYXR0YWNrZXIpLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXHMrL2csIiAiKT09PW5vcm1OO30pOwogICAgdmFyIGQ9bS5kYXRlP25ldyBEYXRlKG0uZGF0ZSkudG9Mb2NhbGVEYXRlU3RyaW5nKCJlcy1FUyIse2RheToiMi1kaWdpdCIsbW9udGg6InNob3J0Iix5ZWFyOiJudW1lcmljIn0pOiJTaW4gZmVjaGEiOwogICAgdmFyIGdvbHM9cFNob3RzLmZpbHRlcihmdW5jdGlvbihzKXtyZXR1cm4gcy5yZXN1bHQ9PT0iZ29sInx8cy5yZXN1bHQ9PT0ic2lucG9ydGVybyI7fSkubGVuZ3RoOwogICAgdmFyIHBhcnM9cFNob3RzLmZpbHRlcihmdW5jdGlvbihzKXtyZXR1cm4gcy5yZXN1bHQ9PT0icGFyYWRhIjt9KS5sZW5ndGg7CiAgICB2YXIgbGFuej1wU2hvdHMuZmlsdGVyKGZ1bmN0aW9uKHMpe3JldHVybiBzLnJlc3VsdCE9PSJmdWVyYSI7fSkubGVuZ3RoOwogICAgdmFyIHBjdD1sYW56PjA/TWF0aC5yb3VuZChnb2xzL2xhbnoqMTAwKTowOwogICAgaHRtbCs9IjxkaXYgY2xhc3M9aXRlbT4iOwogICAgaHRtbCs9IjxkaXY+PGRpdiBzdHlsZT1cImZvbnQtd2VpZ2h0OjYwMFwiPnZzICIrcmQucml2YWwrIjwvZGl2PjxkaXYgY2xhc3M9ZGF0ZT4iK2QrIjwvZGl2PjwvZGl2PiI7CiAgICBodG1sKz0iPGRpdiBjbGFzcz1zdGF0cz4iK3BTaG90cy5sZW5ndGgrIiBsYW56ICZuYnNwOyZtaWRkb3Q7Jm5ic3A7ICIrcGFycysiIHBhciAmbmJzcDsmbWlkZG90OyZuYnNwOyAiK2dvbHMrIiBnb2w8YnI+IjsKICAgIGh0bWwrPSI8c3BhbiBzdHlsZT1cImNvbG9yOiIrKHBjdD49MzA/IiMyMmM1NWUiOnBjdD49MjA/IiNmYjkyM2MiOiIjZWY0NDQ0IikrIlwiPiIrcGN0KyIlIGVmaWMuPC9zcGFuPiI7CiAgICBpZihtLmZpbGVJZClodG1sKz0iPGJ1dHRvbiBjbGFzcz1idG4gb25jbGljaz1cImdvTWF0Y2goIitKU09OLnN0cmluZ2lmeShtLmZpbGVJZCkrIilcIj7wn5OCIElyPC9idXR0b24+IjsKICAgIGh0bWwrPSI8L2Rpdj48L2Rpdj4iOwogIH0pOwogIGh0bWwrPSI8c2NyaXB0PmZ1bmN0aW9uIGdvTWF0Y2goZmlkKXsiOwogIGh0bWwrPSIgIHRyeXsiOwogIGh0bWwrPSIgICAgdmFyIGNhbmRzPVtdOyI7CiAgaHRtbCs9IiAgICB0cnl7Y2FuZHMucHVzaCh3aW5kb3cudG9wKTt9Y2F0Y2goZSl7fSI7CiAgaHRtbCs9IiAgICB0cnl7Y2FuZHMucHVzaCh3aW5kb3cudG9wJiZ3aW5kb3cudG9wLm9wZW5lcik7fWNhdGNoKGUpe30iOwogIGh0bWwrPSIgICAgdHJ5e2NhbmRzLnB1c2god2luZG93Lm9wZW5lcik7fWNhdGNoKGUpe30iOwogIGh0bWwrPSIgICAgdHJ5e2NhbmRzLnB1c2god2luZG93LnBhcmVudCYmd2luZG93LnBhcmVudC5wYXJlbnQpO31jYXRjaChlKXt9IjsKICBodG1sKz0iICAgIHZhciBmbj1udWxsOyI7CiAgaHRtbCs9IiAgICBmb3IodmFyIGk9MDtpPGNhbmRzLmxlbmd0aDtpKyspe2lmKGNhbmRzW2ldJiZ0eXBlb2YgY2FuZHNbaV0ub3Blbk1hdGNoRnJvbVJpdmFscz09PVwiZnVuY3Rpb25cIil7Zm49Y2FuZHNbaV0ub3Blbk1hdGNoRnJvbVJpdmFsczticmVhazt9fSI7CiAgaHRtbCs9IiAgICBpZihmbil7Zm4oZmlkKTt9IjsKICBodG1sKz0iICAgIGVsc2V7dHJ5e2xvY2FsU3RvcmFnZS5zZXRJdGVtKFwiaGJfcGVuZGluZ19vcGVuX21hdGNoXCIsZmlkKTt9Y2F0Y2goZTIpe319IjsKICBodG1sKz0iICB9Y2F0Y2goZXgpe3RyeXtsb2NhbFN0b3JhZ2Uuc2V0SXRlbShcImhiX3BlbmRpbmdfb3Blbl9tYXRjaFwiLGZpZCk7fWNhdGNoKGUyKXt9fSI7CiAgaHRtbCs9In08XC9zY3JpcHQ+PC9ib2R5PjwvaHRtbD4iOwogIHZhciBvdj1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCJkaXYiKTsKICBvdi5zdHlsZS5jc3NUZXh0PSJwb3NpdGlvbjpmaXhlZDt0b3A6MDtsZWZ0OjA7d2lkdGg6MTAwJTtoZWlnaHQ6MTAwJTt6LWluZGV4Ojk5OTk7YmFja2dyb3VuZDojMGExNjI4O2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW4iOwogIHZhciBjYj1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCJidXR0b24iKTsKICBjYi50ZXh0Q29udGVudD0i4pyVIENlcnJhciI7CiAgY2Iuc3R5bGUuY3NzVGV4dD0iYmFja2dyb3VuZDojMWUyOTNiO2NvbG9yOiM5NGEzYjg7Ym9yZGVyOm5vbmU7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuMSk7cGFkZGluZzo4cHggMTZweDtjdXJzb3I6cG9pbnRlcjtmb250LXNpemU6MTNweDt0ZXh0LWFsaWduOmxlZnQiOwogIGNiLm9uY2xpY2s9ZnVuY3Rpb24oKXtvdi5yZW1vdmUoKTt9OwogIHZhciBpZnI9ZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgiaWZyYW1lIik7CiAgaWZyLnN0eWxlLmNzc1RleHQ9ImZsZXg6MTtib3JkZXI6bm9uZTt3aWR0aDoxMDAlO2hlaWdodDoxMDAlIjsKICBpZnIuc3JjZG9jPWh0bWw7CiAgb3YuYXBwZW5kQ2hpbGQoY2IpO292LmFwcGVuZENoaWxkKGlmcik7CiAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChvdik7Cn0K";eval(decodeURIComponent(escape(atob(_NF))));\';var css="*{margin:0;padding:0;box-sizing:border-box}body{background:#0a1628;color:#cbd5e1;font-family:DM Sans,sans-serif;padding:20px}h1,h2,h3{font-family:Bebas Neue,Impact,sans-serif;color:#f8fafc;margin-bottom:12px}h1{font-size:28px;color:#f59e0b}h2{font-size:22px}a.bk{display:inline-block;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#94a3b8;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:13px;margin-bottom:14px;text-decoration:none}div.cd{background:#111f3a;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px 18px;margin-bottom:8px;cursor:pointer;transition:border-color .2s}div.cd:hover{border-color:rgba(245,158,11,.4)}div.ct{font-family:Bebas Neue,Impact,sans-serif;font-size:18px;color:#f8fafc}div.cm{font-size:12px;color:#64748b;margin-top:3px}div.sg{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}div.sb{background:#111f3a;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px}div.sb h4{font-size:10px;color:#64748b;text-transform:uppercase;margin-bottom:4px}div.bn{font-family:Bebas Neue,Impact,sans-serif;font-size:36px;line-height:1}table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px}th{text-align:left;color:#64748b;padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.08);font-size:11px}td{padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.04)}div.st{font-family:Bebas Neue,Impact,sans-serif;font-size:14px;color:#f59e0b;margin:12px 0 6px}canvas{display:block;background:#091524;border-radius:8px;width:100%;margin-bottom:12px}div.pg{display:none}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body,html{background:#0a1628!important}}";var body="<div id=pg-rivals class=pg><h1>&#9876; Rivales</h1><div id=rl></div></div><div id=pg-players class=pg><a class=bk href=#>&#8592; Volver</a><h2 id=rh></h2><button id=rival-matches-btn class=bk style=display:none;margin-right:6px>📋 Ver partidos</button><div id=pl></div></div><div id=pg-report class=pg><a class=bk href=#>&#8592; Volver</a><h2 id=reh></h2><h3 id=pnh></h3><div id=pf-pd-filter style=display:none;gap:8px;margin-bottom:12px></div><div class=sg><div class=sb><h4>Goles marcados</h4><div class=bn style=color:#ef4444 id=xg>-</div></div><div class=sb><h4>Paradas recibidas</h4><div class=bn style=color:#22c55e id=xp>-</div></div><div class=sb><h4>Lanzamientos a puerta</h4><div class=bn style=color:#3b82f6 id=xl>-</div></div><div class=sb><h4>Fuera/Bloqueados</h4><div class=bn style=color:#64748b id=xf>-</div></div><div class=sb><h4>Sin portera</h4><div class=bn style=color:#f59e0b id=xsinport>0</div></div></div><div class=sg style=grid-template-columns:1fr><div class=sb><h4>% Eficiencia lanzadora (goles / lanz. a puerta)</h4><div class=bn id=xpct>-</div></div></div><div class=st>Por zona de lanzamiento</div><table><thead><tr><th>Zona</th><th>Total</th><th>A puerta</th><th>Paradas</th><th>Goles</th><th>% Gol</th></tr></thead><tbody id=zt></tbody></table><div style=margin-bottom:14px><div class=st>Mapa de lanzamientos</div><canvas id=fc style=width:100%;display:block;margin-bottom:12px></canvas><div class=st>Zona de portería</div><svg id=gs style=width:100%;display:block;border-radius:8px;margin-bottom:14px><defs><pattern id=ng x=0 y=0 width=20 height=20 patternUnits=userSpaceOnUse><line x1=0 y1=0 x2=20 y2=20 stroke=rgba(255,255,255,.09) stroke-width=.9/><line x1=20 y1=0 x2=0 y2=20 stroke=rgba(255,255,255,.09) stroke-width=.9/></pattern><pattern id=hp2 x=0 y=0 width=100 height=16 patternUnits=userSpaceOnUse><rect width=100 height=8 fill=#dc2626/><rect y=8 width=100 height=8 fill=#efefef/></pattern><pattern id=hb2 x=0 y=0 width=20 height=100 patternUnits=userSpaceOnUse><rect width=10 height=100 fill=#dc2626/><rect x=10 width=10 height=100 fill=#efefef/></pattern></defs><rect width=420 height=245 fill=#091524 rx=8/><rect x=30 y=20 width=360 height=200 fill=url(#ng)/><rect x=20 y=12 width=380 height=205 fill=none stroke=rgba(0,0,0,.75) stroke-width=16/><rect x=24 y=16 width=372 height=196 fill=none stroke=white stroke-width=5/><rect x=12 y=12 width=22 height=205 fill=url(#hp2)/><rect x=386 y=12 width=22 height=205 fill=url(#hp2)/><rect x=12 y=12 width=396 height=16 fill=url(#hb2)/><line x1=150 y1=28 x2=150 y2=208 stroke=rgba(255,255,255,.3) stroke-width=1.5/><line x1=270 y1=28 x2=270 y2=208 stroke=rgba(255,255,255,.3) stroke-width=1.5/><line x1=34 y1=95 x2=386 y2=95 stroke=rgba(255,255,255,.3) stroke-width=1.5/><line x1=34 y1=162 x2=386 y2=162 stroke=rgba(255,255,255,.3) stroke-width=1.5/><g id=gc></g></svg></div></div>";var h="<!DOCTYPE html><html lang=es><head><meta charset=UTF-8>"+"<title> Rivales</title>"+"<link href=https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;600&display=swap rel=stylesheet>"+"<style>"+css+"</style></head><body>"+body+"<scr"+"ipt>"+scr+"<"+"/scr"+"ipt>";var ov=document.createElement(\'div\');ov.style.cssText=\'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:#0a1628;display:flex;flex-direction:column\';var cb=document.createElement(\'button\');cb.textContent=\'\u2715 Cerrar\';cb.style.cssText=\'background:#1e293b;color:#94a3b8;border:none;border-bottom:1px solid rgba(255,255,255,.1);padding:8px 16px;cursor:pointer;font-size:13px;text-align:left\';cb.onclick=function(){ov.remove();};var ifr=document.createElement(\'iframe\');ifr.style.cssText=\'flex:1;border:none;width:100%;height:100%\';ifr.srcdoc=h;ov.appendChild(cb);ov.appendChild(ifr);document.body.appendChild(ov);}'
    +'var _printChart1=null,_printChart2=null;'
    +'function buildPrintCharts(){var allLabels=seasonChart.data.labels.slice();var allDS=seasonChart.data.datasets.slice();var half=Math.ceil(allLabels.length/2);function sliceDS(ds,s,e){return ds.map(function(d){var nd=Object.assign({},d);nd.data=d.data.slice(s,e);return nd;});}function mkChart(existing,id,labels,ds){if(existing){try{existing.destroy();}catch(e){}}var cv=document.getElementById(id);if(!cv||!labels.length)return null;cv.width=900;cv.height=320;var bx=cv.getContext("2d");bx.clearRect(0,0,900,320);bx.fillStyle="#111f3a";bx.fillRect(0,0,900,320);var bgPlugin={id:"bg",beforeDraw:function(c){var ctx=c.canvas.getContext("2d");ctx.save();ctx.fillStyle="#111f3a";ctx.fillRect(0,0,c.canvas.width,c.canvas.height);ctx.restore;}};return new Chart(cv,{plugins:[bgPlugin],type:"bar",data:{labels:labels,datasets:ds},options:{responsive:false,animation:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:"rgba(255,255,255,.5)",maxRotation:75,minRotation:60},grid:{color:"rgba(255,255,255,.05)"}},y:{min:0,max:70,ticks:{color:"rgba(255,255,255,.5)",callback:function(v){return v+"%";}},grid:{color:"rgba(255,255,255,.05)"},title:{display:true,text:"% Efectividad",color:"rgba(255,255,255,.4)"}}}}});}var leg=document.getElementById("print-legend");if(leg){leg.innerHTML="";allDS.forEach(function(ds){var isLine=ds.type==="line";var c=ds.borderColor;var item=document.createElement("div");item.style.cssText="display:flex;align-items:center;gap:5px;font-size:11px;color:rgba(255,255,255,.8);font-family:DM Sans,sans-serif";var box=document.createElement("div");box.style.cssText="width:14px;height:14px;border-radius:2px;flex-shrink:0;background:"+(isLine?"transparent":c)+";border:2px solid "+c+(isLine?";position:relative":"");if(isLine){var line=document.createElement("div");line.style.cssText="position:absolute;top:50%;left:-3px;right:-3px;height:2px;background:"+c+";transform:translateY(-50%)";box.style.position="relative";box.appendChild(line);}item.appendChild(box);var txt=document.createElement("span");txt.textContent=ds.label;item.appendChild(txt);leg.appendChild(item);});}var needsSplit=allLabels.length*80>900;var wrap2=document.getElementById("printChart2")&&document.getElementById("printChart2").closest(".print-chart-wrap");if(needsSplit){_printChart1=mkChart(_printChart1,"printChart1",allLabels.slice(0,half),sliceDS(allDS,0,half));_printChart2=mkChart(_printChart2,"printChart2",allLabels.slice(half),sliceDS(allDS,half,allLabels.length));if(wrap2){wrap2.style.display="";wrap2.classList.remove("pchide");}}else{if(_printChart2){try{_printChart2.destroy();}catch(e){}}_printChart2=null;if(wrap2){wrap2.classList.add("pchide");}_printChart1=mkChart(_printChart1,"printChart1",allLabels,sliceDS(allDS,0,allLabels.length));}}'
    +'window.addEventListener("beforeprint",function(){buildPrintCharts();document.querySelectorAll("textarea").forEach(function(ta){if(!ta.value.trim())return;var d=document.createElement("div");d.className="print-obs";d.style.cssText="white-space:pre-wrap;font-family:DM Sans,sans-serif;font-size:13px;color:#cbd5e1;padding:10px;border:1px solid rgba(255,255,255,.1);border-radius:8px;word-break:break-word";d.textContent=ta.value;ta.style.display="none";ta.parentNode.insertBefore(d,ta.nextSibling);});});window.addEventListener("afterprint",function(){document.querySelectorAll("textarea").forEach(function(ta){ta.style.display="";});document.querySelectorAll(".print-obs").forEach(function(d){d.remove();});});'
    +'var seasonHabFilter=false;'
    +'function toggleSeasonHab(btn){'
    +'  seasonHabFilter=!seasonHabFilter;'
    +'  if(btn){btn.style.borderColor=seasonHabFilter?"rgba(168,85,247,.8)":"rgba(168,85,247,.3)";btn.style.color=seasonHabFilter?"#d8b4fe":"rgba(168,85,247,.5)";btn.style.background=seasonHabFilter?"rgba(168,85,247,.15)":"transparent";}'
    +'  var fS=curSeasonFilter==="TODOS"?ALL_SHOTS:ALL_SHOTS.filter(function(s){return s.porteroName===curSeasonFilter;});'
    +'  if(seasonHabFilter) fS=fS.filter(function(s){return s.hab;});'
    +'  var filtered=seasonZoneFilter?(function(){var gz=_SGMAP[seasonZoneFilter]||[seasonZoneFilter];return fS.filter(function(s){return gz.indexOf(s.zone)>=0;});}()):fS;'
    +'  drawSeasonRadar(filtered);drawSeasonGoal(filtered);buildZoneRows(filtered);'
    +'}'
    +'window.onload=function(){try{localStorage.removeItem("sb_min");}catch(e){}try{initRatings();}catch(e){}try{buildToggles();buildZoneRows(ALL_SHOTS);setTimeout(function(){drawSeasonRadar(ALL_SHOTS);drawSeasonGoal(ALL_SHOTS);},300);'
    +'setTimeout(function(){var cv=document.getElementById("radar-season-canvas");'
    +'var gc=document.getElementById("goal-season-cells");'
    +'},800);'
    +'initPhotoDrag();var saved=null;try{saved=JSON.parse(localStorage.getItem(\'hb_season_cfg_\'+FOLDER_ID)||null);}catch(ex){}if(saved){if(saved.title&&saved.title!==\'📊 Resumen Temporada\'){var te=document.getElementById(\'season-report-title\');if(te)te.textContent=saved.title;}if(saved.logo){var img=document.getElementById(\'season-logo-img\');var ph=document.getElementById(\'season-logo-placeholder\');var wrap=document.getElementById(\'season-logo-wrap\');if(img&&ph&&wrap){img.src=saved.logo;img.style.display=\'block\';ph.style.display=\'none\';wrap.style.border=\'2px solid rgba(255,255,255,.15)\';}}'
    +'document.querySelectorAll("[data-idx]").forEach(function(el){var idx=el.getAttribute("data-idx");var v=saved&&saved["rival_"+idx];if(v)el.innerText=v;});'
    +'document.querySelectorAll("[data-jidx]").forEach(function(el){var idx=el.getAttribute("data-jidx");var v=saved&&saved["jornada_"+idx];if(v)el.innerText=v;});'
    +'}'
    +'if(!saved||!saved.logo){typeof _downloadPhotoIfMissing==="function"&&_downloadPhotoIfMissing("temporada",FOLDER_ID,function(){return false;},function(b64){var cfg2={};try{cfg2=JSON.parse(localStorage.getItem("hb_season_cfg_"+FOLDER_ID)||"{}")||{};}catch(ex2){}cfg2.logo=b64;try{localStorage.setItem("hb_season_cfg_"+FOLDER_ID,JSON.stringify(cfg2));}catch(ex3){}var img2=document.getElementById("season-logo-img");var ph2=document.getElementById("season-logo-placeholder");var wrap2=document.getElementById("season-logo-wrap");if(img2&&ph2&&wrap2){img2.src=b64;img2.style.display="block";ph2.style.display="none";wrap2.style.border="2px solid rgba(255,255,255,.15)";}},function(){});}'
    +'document.querySelectorAll("[data-idx]").forEach(function(el){_rebuildLabel(parseInt(el.getAttribute("data-idx")));});'
    +'buildPrintCharts();'
    +'}catch(e){console.error("Season onload error:",e);alert("Error al cargar resumen: "+e.message);}'
    +'if(SEASON_JUMP_TO){try{openRivales(SEASON_JUMP_TO);}catch(e){console.error("Auto-jump error:",e);}}'
    +'};'+'</'+'script>'    +'<div style="margin:24px 20px 0;padding-top:18px;border-top:1px solid rgba(255,255,255,.08);page-break-inside:avoid;break-inside:avoid">'
    +'<div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">📝 Observaciones <span id=season-obs-scope style="color:#f59e0b;text-transform:none;letter-spacing:0"></span></div>'
    +'<textarea id=season-obs placeholder="Añade tus observaciones sobre este portero..." '
    +'style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#cbd5e1;font-family:DM Sans,sans-serif;font-size:13px;padding:10px;resize:vertical;min-height:100px"></textarea>'
    +'</div>'
    +'<script>'
    +'(function(){'
    // Cada card de portero (y la card "TODOS", para una valoración general) tiene sus propias
    // observaciones, guardadas bajo una clave distinta por portero. "TODOS" reutiliza la clave
    // antigua sin sufijo para no perder las observaciones generales ya escritas antes de este cambio.
    +'function obsKey(name){return name==="TODOS"?("season_obs_"+FOLDER_ID):("season_obs_"+FOLDER_ID+"_"+encodeURIComponent(name));}'
    +'var ta=document.getElementById("season-obs");'
    +'var scope=document.getElementById("season-obs-scope");'
    +'window._loadSeasonObs=function(name){'
    +'  try{ta.value=localStorage.getItem(obsKey(name))||"";}catch(e){ta.value="";}'
    +'  if(scope)scope.textContent=name==="TODOS"?"· General (TODOS)":"· "+name;'
    +'};'
    +'ta.oninput=function(){try{localStorage.setItem(obsKey(typeof curSeasonFilter!=="undefined"?curSeasonFilter:"TODOS"),ta.value);}catch(e){};};'
    +'window._loadSeasonObs(typeof curSeasonFilter!=="undefined"?curSeasonFilter:"TODOS");'
    +'})()'
    +'</'+'script>'
    +'</body></html>';


  return html;
}
function pctColor(p){
  return p===null?'#64748b':p>=40?'#6366f1':p>=35?'#38bdf8':p>=30?'#16a34a':p>=25?'#86efac':p>=20?'#fb923c':'#ef4444';
}
// Planificador de páginas del PDF (2026-09-21). El navegador reparte el contenido en orden y
// no puede recolocar: si la siguiente unidad no cabe, salta de página y deja el hueco (p. ej. la
// 1ª página solo con el marcador). Aquí se MIDE el layout de impresión de verdad (las reglas
// @media print se activan un instante como "all", con el ancho útil de un A4) y se simula el
// reparto con 3 niveles de compactación; se elige el que da menos páginas y menos hueco en las
// que no son la última. Solo se toca el espaciado y el tamaño de radar/portería, nunca el texto.
var PDF_TL_H=[380,340,300,260]; // alto de la gráfica de evolución en el PDF, por nivel de compactación
function _pdfPlanPaginas(){
  var rules=[], appEl=document.querySelector('.app'), sec=document.getElementById('sec-estadisticas');
  try{
    Array.prototype.forEach.call(document.styleSheets,function(ss){
      var rs; try{ rs=ss.cssRules; }catch(e){ return; }
      Array.prototype.forEach.call(rs,function(r){ if(r.type===4 && r.media && r.media.mediaText.indexOf('print')>=0) rules.push(r); });
    });
  }catch(e){}
  if(!rules.length || !appEl || !sec) return 0;
  var PAGE_H=Math.round((297-12)/25.4*96)-18; // A4 menos márgenes de @page (6mm) y un margen de seguridad
  var PAGE_W=Math.round((210-12)/25.4*96);
  var oldW=document.body.style.width, saved=rules.map(function(r){return r.media.mediaText;});
  var best=0, bestScore=Infinity;
  try{
    rules.forEach(function(r){ r.media.mediaText='all'; });
    document.body.style.width=PAGE_W+'px';
    var tlc=document.getElementById('timeline-canvas'), tlOld=tlc?tlc.style.height:'';
    [0,1,2,3].forEach(function(lv){
      document.body.classList.remove('pdf-c1','pdf-c2','pdf-c3'); if(lv) document.body.classList.add('pdf-c'+lv);
      if(tlc) tlc.style.height=PDF_TL_H[lv]+'px';
      var base=appEl.getBoundingClientRect().top;
      var els=[document.querySelector('.timer-bar'),document.getElementById('match-header-display')].concat(Array.prototype.slice.call(sec.querySelectorAll('.pk-unit')));
      var units=els.filter(function(e){ return e && e.offsetParent!==null && e.getBoundingClientRect().height>0; }).map(function(e){
        var b=e.getBoundingClientRect(); return {top:b.top-base,bottom:b.bottom-base};
      });
      var pages=1, start=0, waste=0, lastBottom=0;
      units.forEach(function(u,i){
        if(i>0 && u.bottom-start>PAGE_H && u.top>start){ waste+=Math.max(0,PAGE_H-(lastBottom-start)); pages++; start=u.top; }
        lastBottom=u.bottom;
      });
      var score=pages*100000+waste+lv*50; // menos páginas, luego menos hueco, luego menos compactación
      if(score<bestScore){ bestScore=score; best=lv; }
    });
  } finally {
    rules.forEach(function(r,i){ r.media.mediaText=saved[i]; });
    document.body.style.width=oldW;
    document.body.classList.remove('pdf-c1','pdf-c2','pdf-c3');
    if(tlc) tlc.style.height=tlOld;
  }
  return best;
}
function exportStatsPDF(){
  var old=document.title;
  var matchTitle=document.getElementById('main-title')?document.getElementById('main-title').textContent.trim():'';
  var rival=document.getElementById('rival-name')?document.getElementById('rival-name').value.trim():'';
  var pname=filterPortero==='all'?'Todas':filterPortero;
  document.title=(matchTitle?matchTitle+' · ':'')+(rival?'vs '+rival+' · ':'')+pname+' · '+new Date().toLocaleDateString('es-ES');

  // Force re-render with current filter
  renderStats();

  // Add visible filter indicator for PDF
  var indicator=document.createElement('div');
  indicator.id='pdf-filter-indicator';
  indicator.style.cssText='background:#1c2e4a;border:1px solid rgba(245,158,11,.4);border-radius:8px;padding:8px 14px;margin-bottom:12px;font-size:13px;color:#f59e0b;font-weight:600;display:none';
  indicator.textContent='🔍 Filtro activo: '+(filterPortero==='all'?'Todas las porteras':filterPortero);
  var statsEl=document.getElementById('sec-estadisticas');
  if(statsEl) statsEl.insertBefore(indicator,statsEl.children[1]);

  // In print: show indicator SOLO si hay filtro activo, hide multi-photo if filtered
  var printStyle=document.createElement('style');
  printStyle.id='pdf-temp-style';
  if(filterPortero!=='all'){
    printStyle.textContent='@media print{#pdf-filter-indicator{display:none!important}#porteros-photos-display{display:none!important}}';
  } else {
    printStyle.textContent='@media print{#pdf-filter-indicator{display:none!important}#portero-photo-display{display:none!important}#porteros-photos-display{display:flex!important}}';
  }
  document.head.appendChild(printStyle);

  // PDF con UN solo portero seleccionado (2026-09-21): su foto pasa al extremo izquierdo de la
  // tarjeta Global y el título "Global" se sustituye por "dorsal. Nombre" (p. ej. "1. David Faílde").
  var gTitle=document.getElementById('global-title'), gTitleOld=gTitle?gTitle.innerHTML:'';
  var pRow=null, pPhotoParent=null, pPhotoNext=null;
  if(filterPortero!=='all'){
    var pSel=porteros.find(function(p){return p.name===filterPortero;});
    if(gTitle) gTitle.textContent=((pSel&&String(pSel.dorsal||'').trim())?String(pSel.dorsal).trim()+'. ':'')+filterPortero;
    var phEl=document.getElementById('portero-photo-display');
    if(phEl && phEl.style.display!=='none' && phEl.parentNode && phEl.parentNode.parentNode){
      pPhotoParent=phEl.parentNode; pPhotoNext=phEl.nextSibling; pRow=pPhotoParent.parentNode;
      pRow.insertBefore(phEl,pRow.firstChild);
      printStyle.textContent+='@media print{#global-row{justify-content:flex-start!important;gap:14px!important}#portero-photo-display{width:88px!important;height:88px!important;margin-right:4px!important;flex-shrink:0!important}}';
    }
  }
  var appEl=document.querySelector('.app');
  var secEl=document.getElementById('sec-estadisticas');
  var bodyEl=document.body;
  var htmlEl=document.documentElement;
  var oldAppStyle=appEl?appEl.style.cssText:'';
  var oldSecStyle=secEl?secEl.style.cssText:'';
  if(appEl){appEl.style.height='auto';appEl.style.overflow='visible';}
  if(secEl){secEl.style.height='auto';secEl.style.overflow='visible';}
  bodyEl.style.overflow='visible';
  htmlEl.style.overflow='visible';

  // Reestructurar fila superior: logo + título del club + rival en el medio + marcador.
  // El tiempo/botones no se muestran en el informe (no aportan valor en un PDF).
  var logoImg=document.getElementById('logo-img');
  var timerBar=document.querySelector('.timer-bar');
  var scoreboardEl=document.querySelector('.scoreboard');
  var mainTitleEl=document.getElementById('main-title');
  var logoClone=null, infoBlock=null;

  if(logoImg && logoImg.style.display==='block' && logoImg.src && timerBar){
    logoClone=logoImg.cloneNode(true);
    logoClone.removeAttribute('id'); logoClone.id='print-logo-clone';
    timerBar.insertBefore(logoClone,timerBar.firstChild);
  }
  if(timerBar && scoreboardEl){
    infoBlock=document.createElement('div');
    infoBlock.id='print-header-info';
    var titleTxt=mainTitleEl?mainTitleEl.textContent.trim():'';
    if(titleTxt){
      var t=document.createElement('div');
      t.id='print-header-title';
      t.textContent=titleTxt;
      infoBlock.appendChild(t);
    }
    if(rival){
      var r=document.createElement('div');
      r.id='print-header-rival';
      r.textContent='vs '+rival;
      infoBlock.appendChild(r);
    }
    // La fecha va justo debajo del rival, dentro de esta cabecera (antes ocupaba un cuadrante propio).
    var dateSrc=document.getElementById('match-date-display');
    var dateTxt=dateSrc?dateSrc.textContent.trim():'';
    if(dateTxt){
      var dd=document.createElement('div');
      dd.id='print-header-date';
      dd.textContent=dateTxt;
      infoBlock.appendChild(dd);
    }
    timerBar.insertBefore(infoBlock,scoreboardEl);
  }

  // Tiempo jugado, justo al lado del marcador (sin botones ni estado del cronómetro)
  var timerDisplay=document.getElementById('timer-display');
  var timeBlock=null, timeOrigParent=null, timeOrigNext=null;
  if(timerDisplay && scoreboardEl && timerBar){
    timeOrigParent=timerDisplay.parentNode; timeOrigNext=timerDisplay.nextSibling;
    timeBlock=document.createElement('div');
    timeBlock.id='print-time-block';
    var timeLbl=document.createElement('div');
    timeLbl.id='print-time-label'; timeLbl.textContent='Tiempo';
    timeBlock.appendChild(timeLbl);
    timeBlock.appendChild(timerDisplay);
    timerBar.insertBefore(timeBlock,scoreboardEl.nextSibling);
  }

  // Si el filtro es "Todos", mostrar las fotos de todas las porteras (igual que
  // cuando hay una sola seleccionada se muestra solo la suya).
  var photosDiv=document.getElementById('porteros-photos-display');
  var photoDiv=document.getElementById('portero-photo-display');
  if(filterPortero==='all'){
    if(photosDiv) photosDiv.style.setProperty('display','flex','important');
    if(photoDiv) photoDiv.style.setProperty('display','none','important');
  } else {
    if(photosDiv) photosDiv.style.setProperty('display','none','important');
  }

  var pdfLevel=0;
  try{ pdfLevel=_pdfPlanPaginas(); }catch(e){ pdfLevel=0; }
  window._pdfTlH=PDF_TL_H[pdfLevel]||380;
  if(pdfLevel) document.body.classList.add('pdf-c'+pdfLevel);
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){
      window.print();
      document.body.classList.remove('pdf-c1','pdf-c2','pdf-c3');
      window._pdfTlH=0;
      // Cleanup
      if(appEl) appEl.style.cssText=oldAppStyle;
      if(secEl) secEl.style.cssText=oldSecStyle;
      bodyEl.style.overflow='';
      htmlEl.style.overflow='';
      document.title=old;
      var ind=document.getElementById('pdf-filter-indicator');
      if(ind) ind.remove();
      var ps=document.getElementById('pdf-temp-style');
      if(ps) ps.remove();
      if(infoBlock) infoBlock.remove();
      if(logoClone) logoClone.remove();
      if(timeBlock){
        if(timeOrigParent) timeOrigParent.insertBefore(timerDisplay,timeOrigNext);
        timeBlock.remove();
      }
      if(photosDiv) photosDiv.style.removeProperty('display');
      if(photoDiv) photoDiv.style.removeProperty('display');
      if(gTitle) gTitle.innerHTML=gTitleOld;
      if(pRow && photoDiv && pPhotoParent) pPhotoParent.insertBefore(photoDiv,pPhotoNext);
      try{ renderStats(); }catch(e){}
    });
  });
}
// ===== STARTUP =====
initStorage(function(){
_purgeOldTrash();
_purgeOldRivalsTrash();
_takeSnapshotIfNeeded();
// ── Firebase sync on startup ──
window._appLoaded = false;
function _startFbSync(){
  // force=true (2026-09-16): sin esto, el arranque confiaba en la marca de tiempo local
  // (hb_fs6_ts/hb_rivals6_ts) para decidir si hacía falta bajar algo — la misma suposición
  // que ya falló una vez con el botón manual (regla 28). Si esa marca queda igual o por
  // delante de la de la nube (p.ej. justo después de una sincronización manual), CADA
  // arranque posterior se saltaba la comprobación real y el directorio podía quedarse
  // mostrando datos obsoletos o vacíos sin que nada avisara del problema. Forzar la
  // comprobación real en cada arranque es justo lo que pidió el usuario ("que al abrirla
  // aparezca ya la última versión") y es coherente con lo ya aprendido: no fiarse nunca de
  // esa marca cuando lo que importa es la fiabilidad, no ahorrarse una lectura de red.
  _fbMergeOnStart(null, true);
  _fbMergeRivalsOnStart(null, true);
  _syncPhotos(false);
  // Listen for real-time changes from other devices
  if(window._fbDb && window._fbOnSnapshot){
    // Escuchaba antes 'hb_fs6', un documento que ninguna escritura genera nunca (todas
    // van a 'hb_structure'), así que esto no se disparaba jamás. Además 'hb_structure'
    // tiene forma {folders,fileIds,ts}, no la forma {folders,files} de _fsCache, así que
    // no basta con cambiar el id del documento: reutilizamos _fbMergeOnStart(), que ya
    // sabe resolver esa forma correctamente (línea ~1785), en vez de duplicar esa lógica.
    window._fbOnSnapshot(
      window._fbDoc(window._fbDb, 'sync', 'hb_structure'),
      function(snap){
        if(!snap.exists() || !window._appLoaded) return;
        _fbMergeOnStart();
      },
      function(err){ console.warn('Firebase listener error:', err); }
    );
    // Mismo mecanismo para rivales (antes no tenía NINGÚN pull automático, ni al
    // arrancar ni en tiempo real — solo se bajaba pulsando el botón manual ⬇️).
    window._fbOnSnapshot(
      window._fbDoc(window._fbDb, 'sync', 'hb_rivals6'),
      function(snap){
        if(!snap.exists() || !window._appLoaded) return;
        _fbMergeRivalsOnStart();
      },
      function(err){ console.warn('Firebase listener error (rivals):', err); }
    );
    // Fotos: cuando otro dispositivo sube una, se baja aquí (solo lectura, ver _syncPhotos).
    window._fbOnSnapshot(
      window._fbDoc(window._fbDb, 'sync', 'hb_photo_meta'),
      function(snap){
        if(!snap.exists() || !window._appLoaded) return;
        _syncPhotos(true);
      },
      function(err){ console.warn('Firebase listener error (fotos):', err); }
    );
  }
}
if(window._fbReady){ _startFbSync(); }
else { window.addEventListener('firebase-ready', _startFbSync); }

// ===== BOOT =====
// Restore last title, logo and porteros on startup
(function(){
  var lastTitle=localStorage.getItem('hb_last_title');
  var lastLogo=localStorage.getItem('hb_last_logo');
  if(lastTitle) document.getElementById('main-title').textContent=lastTitle;
  if(lastLogo){
    var li=document.getElementById('logo-img'); var lp=document.getElementById('logo-plus');
    li.src=lastLogo; li.style.display='block'; lp.style.display='none';
  }
  var lastP=null;
  try{ lastP=JSON.parse(localStorage.getItem('hb_last_porteros')); }catch(e){}
  if(lastP&&lastP.length>=2){
    porteros=lastP.map(function(p){return{id:p.id,name:p.name,dorsal:p.dorsal||'',photo:null,seconds:0,ox:p.ox||50,oy:p.oy||20};});
    rehydratePhotos(porteros);
    nextPid=Math.max.apply(null,porteros.map(function(p){return p.id;}))+1;
    activePorteroId=porteros[0].id;
  }
})();
renderPorteros(); renderLog(); renderStats(); renderOfensiva();

// Auto-save on page unload / tab hide so name changes are never lost
window.addEventListener('beforeunload', function(){ if(currentMatchId) saveMatch(); });
document.addEventListener('visibilitychange', function(){ if(document.hidden && currentMatchId) saveMatch(); });

// El canvas de "Evolución a lo largo del partido" fija su tamaño en píxeles (style.width/height)
// leyendo offsetWidth/offsetHeight en el momento de dibujar. Si la ventana cambia de tamaño o el
// tablet rota después de ese dibujado, el canvas se queda con el tamaño antiguo y se ve deformado
// — no hay ningún redibujado automático salvo al cambiar de pestaña. Lo forzamos aquí.
var _timelineResizeTO=null;
window.addEventListener('resize', function(){
  clearTimeout(_timelineResizeTO);
  _timelineResizeTO=setTimeout(function(){
    var sec=document.getElementById('sec-estadisticas');
    if(sec && sec.classList.contains('active')){
      try{ drawTimeline(getFilteredShots()); }catch(e){}
    }
  }, 150);
});

// Recibe el "Ir al partido" desde la ventana de Resumen de temporada / Informe de
// rivales cuando esa ventana no puede llamar directamente a openMatchFromRivals
// (p.ej. ventana nativa NW.js sin relación opener/parent accesible) — se avisa
// vía localStorage compartido en vez de mostrar un aviso de "ábrelo manualmente".
window.addEventListener('storage', function(e){
  if(e.key==='hb_pending_open_match' && e.newValue){
    try{ openMatchFromRivals(e.newValue); }catch(ex){}
    try{ localStorage.removeItem('hb_pending_open_match'); }catch(ex){}
  }
});
window._appLoaded = true;

// ── Fix gráfico de evolución en impresión PDF: forzar altura fija razonable
// y redibujar a esa medida, para que no se deforme al cambiar el ancho de página ──
// ── Desactivar pull-to-refresh sin afectar el scroll normal ──
// Compara cada movimiento con el punto INMEDIATAMENTE ANTERIOR (no con el
// inicio del gesto), así que en cuanto el dedo cambia de dirección el scroll
// normal se reanuda al instante.
(function(){
  var lastY = null;
  document.addEventListener('touchstart', function(e){
    lastY = e.touches[0].clientY;
  }, {passive:true});
  document.addEventListener('touchmove', function(e){
    var y = e.touches[0].clientY;
    var atTop = (window.scrollY || document.documentElement.scrollTop) <= 0;
    if(atTop && lastY !== null && y > lastY){
      e.preventDefault();
    }
    lastY = y;
  }, {passive:false});
  document.addEventListener('touchend', function(){ lastY = null; }, {passive:true});
})();

window.addEventListener('beforeprint', function(){
  var tl = document.getElementById('timeline-canvas');
  if(tl){
    tl._origHeight = tl.style.height;
    tl.style.height = (window._pdfTlH||380)+'px';
    try{ drawTimeline(getFilteredShots()); }catch(e){}
  }
});
window.addEventListener('afterprint', function(){
  var tl = document.getElementById('timeline-canvas');
  if(tl){
    tl.style.height = tl._origHeight || '';
    try{ drawTimeline(getFilteredShots()); }catch(e){}
  }
});

});
if('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('./sw.js').catch(function(){});
  });
  // Un PWA instalado en el móvil, al "reabrirse" desde la lista de apps recientes, muchas
  // veces no recarga el documento de verdad — retoma la MISMA página ya cargada en memoria,
  // con el código JS que tuviera en ese momento, por mucho que se haya publicado una
  // versión nueva mientras tanto (2026-09-16: esto costó una sesión entera de confusión
  // creyendo que fallaba la sincronización, cuando en realidad el móvil seguía corriendo
  // una versión de un rato antes). 'controllerchange' se dispara cuando el nuevo service
  // worker activado por sw.js toma el control — en ese momento SÍ hay una versión más
  // reciente disponible, así que se recarga automáticamente en vez de esperar a que el
  // usuario cierre y reabra manualmente (que en el móvil no basta, como se ha visto).
  navigator.serviceWorker.addEventListener('controllerchange', function(){
    window.location.reload();
  });
}
// Comprobación de versión propia (2026-09-21): lo de arriba SOLO recarga si cambia sw.js, y
// varios despliegues seguidos no lo tocaron — la tablet siguió ejecutando una versión vieja
// (seguía dejando pulsar goles propios en el gráfico) aunque se cerrara y reabriera la app.
// Ahora cada despliegue actualiza version.json junto con BUILD_ID: al abrir y cada vez que la
// app vuelve a primer plano se compara y, si difiere, se recarga (salvo con el cronómetro en
// marcha, para no interrumpir un partido; y como mucho una vez por minuto, para evitar bucles).
// Regla 85: desde que este script vive en app.js (cargado con <script src="app.js?v=...">),
// CADA DESPLIEGUE debe poner el MISMO valor en 4 sitios: este BUILD_ID, el "?v=" del <script
// src="app.js?v=..."> en balonmano_stats.html, version.json, y CACHE en sw.js si cambian los
// archivos cacheados. El "?v=" es imprescindible: como app.js se sirve cache-first con
// actualización en segundo plano (igual que el HTML, regla 83), sin una URL distinta por
// versión un despliegue nuevo podría servir el HTML nuevo con un app.js viejo todavía en
// caché (mezcla incompatible). Con la query cambiando en cada versión, una URL nueva nunca
// puede coincidir con una entrada de caché de una versión anterior.
var BUILD_ID = '2026-09-27-e';
(function(){
  var st=document.getElementById('build-stamp'); if(st) st.textContent='v'+BUILD_ID;
  // Regla 83: el SW sirve el HTML desde su caché; la recarga por versión nueva lleva ?fresh= para
  // que esa carga venga de la red. Se quita de la URL para que no se quede pegado.
  if(/[?&]fresh=/.test(location.search)){ try{ history.replaceState(null,'',location.pathname+location.hash); }catch(e){} }
  function checkVersion(){
    fetch('./version.json?t='+Date.now(), {cache:'no-store'}).then(function(r){ return r.json(); }).then(function(v){
      if(!v || !v.build || v.build===BUILD_ID) return;
      if(timerRunning || realTimerRunning){ notify('🔄 Hay una versión nueva: se aplicará al detener el cronómetro'); return; }
      var last=0; try{ last=parseInt(sessionStorage.getItem('hb_reload_ts')||'0',10); }catch(e){}
      if(Date.now()-last<60000) return;
      try{ sessionStorage.setItem('hb_reload_ts', String(Date.now())); }catch(e){}
      window.location.replace(location.pathname+'?fresh='+encodeURIComponent(v.build)+location.hash);
    }).catch(function(){});
  }
  window.addEventListener('load', function(){ setTimeout(checkVersion, 3000); });
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) checkVersion(); });
})();
