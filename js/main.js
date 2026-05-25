const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwHK0oo4SHviMpKj9yZ_tOnA61JwSMjh1x3Ds_yhsUxYYZEchzXAdzNwQtEqSYdwU5aig/exec"; 
let dataBDS = {}; 
const infoBox = document.getElementById('info-box');

// Tải ĐỒNG THỜI file SVG và dữ liệu từ Google Sheets
Promise.all([
    fetch('assets/svg/map.svg').then(response => response.text()),
    fetch(SCRIPT_URL).then(response => response.json())
])
.then(([svgContent, data]) => {
    // 1. Nhúng đoạn mã SVG vào trang HTML
    document.getElementById('map-wrapper').innerHTML = svgContent;
    
    // 2. Lưu dữ liệu Google Sheet
    dataBDS = data; 
    console.log("Đã tải dữ liệu và bản đồ thành công!");
    
    // 3. Khởi tạo chức năng (Vẽ tên lô, Click, Zoom)
    initMap();      
    initZoom();     
})
.catch(error => {
    console.error("Lỗi khởi tạo:", error);
    alert("Không thể tải dữ liệu hoặc bản đồ. Vui lòng kiểm tra lại đường dẫn!");
});
// Hàm xử lý bản đồ (Tích hợp thuật toán PCA không gian và Override từ Sheet)
function initMap() {
    document.querySelectorAll('svg g[id]').forEach(lot => {
        const id = lot.id;
        
        if (dataBDS[id]) {
            const info = dataBDS[id];
            lot.classList.add('lot-interactive');

            const allShapes = lot.querySelectorAll('rect, polygon, path, polyline, line');
            if (allShapes.length === 0) return;
            
            // Đổi màu Đã Bán
            if (info.TrangThai === "Đã bán" || info.TrangThai === "Đã Bán") {
                allShapes.forEach(shape => {
                    shape.style.fill = "#7f8c8d"; 
                    shape.style.opacity = "0.8";  
                });
            }

            // --- THUẬT TOÁN 1: Tìm góc xoay Transform ngầm của CAD ---
            let accRot = 0;
            let curr = allShapes[0];
            while (curr && curr !== lot.parentNode) {
                let tf = curr.getAttribute('transform');
                if (tf) {
                    let rMatch = tf.match(/rotate\(([-0-9.]+)/);
                    if (rMatch) accRot += parseFloat(rMatch[1]);
                    
                    let mMatch = tf.match(/matrix\(([^)]+)\)/);
                    if (mMatch) {
                        let vals = mMatch[1].split(/[\s,]+/).map(parseFloat);
                        if (vals.length >= 4) accRot += Math.atan2(vals[1], vals[0]) * (180 / Math.PI);
                    }
                }
                curr = curr.parentNode;
            }

            // --- THUẬT TOÁN 2: Phân tích PCA (Principal Component Analysis) ---
            let segments = [];
            function addSeg(x1, y1, x2, y2) {
                let dx = x2 - x1, dy = y2 - y1;
                let len = Math.sqrt(dx*dx + dy*dy);
                if (len > 0.5) segments.push({x1, y1, x2, y2, len});
            }

            allShapes.forEach(shape => {
                let tagName = shape.tagName.toLowerCase();
                if (tagName === 'rect') {
                    let x = parseFloat(shape.getAttribute('x')||0), y = parseFloat(shape.getAttribute('y')||0);
                    let w = parseFloat(shape.getAttribute('width')||0), h = parseFloat(shape.getAttribute('height')||0);
                    addSeg(x, y, x+w, y); addSeg(x+w, y, x+w, y+h); addSeg(x+w, y+h, x, y+h); addSeg(x, y+h, x, y);
                } else if (tagName === 'line') {
                    addSeg(parseFloat(shape.getAttribute('x1')), parseFloat(shape.getAttribute('y1')),
                           parseFloat(shape.getAttribute('x2')), parseFloat(shape.getAttribute('y2')));
                } else if (tagName === 'polygon' || tagName === 'polyline') {
                    const ptsStr = shape.getAttribute('points');
                    if (ptsStr) {
                        const coords = ptsStr.trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));
                        for (let i = 0; i < coords.length - 3; i += 2) {
                            addSeg(coords[i], coords[i+1], coords[i+2], coords[i+3]);
                        }
                        if (tagName === 'polygon' && coords.length >= 4) {
                            addSeg(coords[coords.length-2], coords[coords.length-1], coords[0], coords[1]);
                        }
                    }
                }
            });

            let intrinsicAngle = 0;
            if (segments.length > 0) {
                // Tìm trọng tâm chu vi
                let cx = 0, cy = 0, totalLen = 0;
                segments.forEach(seg => {
                    let mx = (seg.x1 + seg.x2)/2, my = (seg.y1 + seg.y2)/2;
                    cx += mx * seg.len; cy += my * seg.len; totalLen += seg.len;
                });
                if (totalLen > 0) { cx /= totalLen; cy /= totalLen; }

                // Tính ma trận hiệp phương sai để tìm trục chính
                let Ixx = 0, Iyy = 0, Ixy = 0;
                segments.forEach(seg => {
                    let mx = (seg.x1 + seg.x2)/2 - cx;
                    let my = (seg.y1 + seg.y2)/2 - cy;
                    Ixx += (mx * mx) * seg.len;
                    Iyy += (my * my) * seg.len;
                    Ixy += (mx * my) * seg.len;
                });
                intrinsicAngle = 0.5 * Math.atan2(2 * Ixy, Ixx - Iyy) * (180 / Math.PI);
            }

            // 3. Tổng hợp góc và chuẩn hóa (Mặc định)
            let finalAngle = (intrinsicAngle + accRot) % 180;
            
            // 4. [TÍNH NĂNG ĐẶC QUYỀN]: Đọc góc điều chỉnh thủ công từ Google Sheet
            // Nếu bạn có cột "GocXoay" trên sheet, code sẽ tự động nhận và cộng thêm vào
            if (info.GocXoay !== undefined && info.GocXoay !== "" && info.GocXoay !== "-") {
                let manualAngle = parseFloat(info.GocXoay);
                if (!isNaN(manualAngle)) {
                    finalAngle += manualAngle;
                }
            }

            // Chuẩn hóa lần cuối để chữ luôn đọc được từ trái sang phải
            while (finalAngle > 90) finalAngle -= 180;
            while (finalAngle <= -90) finalAngle += 180;

            // 5. Chèn nhãn Text vào tâm
            const bbox = lot.getBBox();
            const centerX = bbox.x + bbox.width / 2;
            const centerY = bbox.y + bbox.height / 2;

            const textLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
            textLabel.setAttribute("x", centerX);
            textLabel.setAttribute("y", centerY);
            textLabel.setAttribute("text-anchor", "middle");
            textLabel.setAttribute("dominant-baseline", "central"); 
            textLabel.setAttribute("class", "lot-label");
            textLabel.setAttribute("transform", `rotate(${finalAngle} ${centerX} ${centerY})`);
            textLabel.textContent = id; 
            lot.appendChild(textLabel);

            // --- SỰ KIỆN CLICK MỞ POPUP (Giữ nguyên cấu trúc Map dữ liệu) ---
            lot.addEventListener('click', function(e) {
                document.getElementById('malo').innerText = "Lô: " + id;
                
                const statusEl = document.getElementById('trangThai');
                statusEl.innerText = info.TrangThai; 
                if (info.TrangThai === "Đang bán") {
                    statusEl.style.color = "#27ae60"; 
                } else if (info.TrangThai === "Đã bán" || info.TrangThai === "Đã Bán") {
                    statusEl.style.color = "#e74c3c"; 
                } else {
                    statusEl.style.color = "#f39c12"; 
                }

                document.getElementById('loai').innerText = info.Loai;
                document.getElementById('dientich').innerText = info.DienTichLo;
                
                const constructInfo = document.getElementById('construction-info');
                
                if (info.Loai && info.Loai.toLowerCase() === "đất nền") {
                    constructInfo.style.display = "none";
                } else {
                    constructInfo.style.display = "block";
                    document.getElementById('sotang').innerText = info.ChieuCao || "-";
                    document.getElementById('dtxd').innerText = info.DienTichXD || "-";
                    document.getElementById('matdo').innerText = info.MatDo || "-";
                    document.getElementById('t1').innerText = info.Tang1 || "-";
                    document.getElementById('t2').innerText = info.Tang2 || "-";
                    document.getElementById('t3').innerText = info.Tang3 || "-";
                    document.getElementById('t4').innerText = info.Tang4 || "-";
                    document.getElementById('tongSan').innerText = info.TongSanXD || "-";
                }

                infoBox.style.display = "block";
                if (window.innerWidth <= 768) {
                    infoBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
                e.stopPropagation(); 
            });
        }
    });
}
// Đóng popup khi click ra ngoài
document.addEventListener('click', function() { infoBox.style.display = "none"; });
infoBox.addEventListener('click', function(e) { e.stopPropagation(); });

// Hàm khởi tạo Zoom (Giữ nguyên logic của bạn)
function initZoom() {
        var eventsHandler = {
            haltEventListeners: ['touchstart', 'touchend', 'touchmove', 'touchleave', 'touchcancel'],
            init: function(options) {
                var instance = options.instance, initialScale = 1, pannedX = 0, pannedY = 0;
                this.hammer = new Hammer(options.svgElement, { 
                    recognizers: [ [Hammer.Pan, {direction: Hammer.DIRECTION_ALL}], [Hammer.Pinch, {enable: true}] ] 
                });
                this.hammer.on('panstart panmove', function(ev){
                    if (ev.type === 'panstart') { pannedX = 0; pannedY = 0; }
                    instance.panBy({x: ev.deltaX - pannedX, y: ev.deltaY - pannedY});
                    pannedX = ev.deltaX; pannedY = ev.deltaY;
                });
                this.hammer.on('pinchstart pinchmove', function(ev){
                    if (ev.type === 'pinchstart') { initialScale = instance.getZoom(); }
                    instance.zoomAtPoint(initialScale * ev.scale, {x: ev.center.x, y: ev.center.y});
                });
            },
            destroy: function(){ this.hammer.destroy(); }
        };

        svgPanZoom('#map-svg', {
            zoomEnabled: true,
            controlIconsEnabled: true, 
            fit: true,                 
            center: true,              
            minZoom: 0.5,
            maxZoom: 10,
            mouseWheelZoomEnabled: true, 
            preventMouseEventsDefault: false, 
            customEventsHandler: eventsHandler 
        });
    }
