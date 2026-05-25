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
// Hàm xử lý bản đồ (Phiên bản: Smart Consensus + Curve Detection + Sheet Override)
function initMap() {
    const lotElements = document.querySelectorAll('svg g[id]');
    const lotMetrics = {}; 

    // ==========================================
    // BƯỚC 1: QUÉT TẤT CẢ ĐỂ TÍNH GÓC THÔ & TỌA ĐỘ
    // ==========================================
    lotElements.forEach(lot => {
        const id = lot.id;
        if (!dataBDS[id]) return;

        lot.classList.add('lot-interactive');
        const allShapes = lot.querySelectorAll('rect, polygon, path, polyline, line');
        if (allShapes.length === 0) return;

        const info = dataBDS[id];
        // Tô màu lô Đã Bán
        if (info.TrangThai === "Đã bán" || info.TrangThai === "Đã Bán") {
            allShapes.forEach(shape => {
                shape.style.fill = "#7f8c8d"; 
                shape.style.opacity = "0.8";  
            });
        }

        let bestAngle = 0;
        let maxEdgeWeight = 0;

        allShapes.forEach(shape => {
            let tagName = shape.tagName.toLowerCase();
            let intrinsicAngle = 0;
            let weight = 0;

            if (tagName === 'rect') {
                const w = parseFloat(shape.getAttribute('width') || 0);
                const h = parseFloat(shape.getAttribute('height') || 0);
                intrinsicAngle = (h > w) ? -90 : 0;
                weight = Math.max(w, h);
            } else {
                let points = [];
                if (tagName === 'line') {
                    points.push({x: parseFloat(shape.getAttribute('x1')), y: parseFloat(shape.getAttribute('y1'))});
                    points.push({x: parseFloat(shape.getAttribute('x2')), y: parseFloat(shape.getAttribute('y2'))});
                } else if (tagName === 'polygon' || tagName === 'polyline') {
                    const ptsStr = shape.getAttribute('points');
                    if (ptsStr) {
                        const coords = ptsStr.trim().split(/[\s,]+/).map(parseFloat);
                        for (let i = 0; i < coords.length; i += 2) {
                            if (!isNaN(coords[i]) && !isNaN(coords[i+1])) points.push({x: coords[i], y: coords[i+1]});
                        }
                        if (tagName === 'polygon' && points.length > 0) points.push(points[0]);
                    }
                } else if (tagName === 'path') {
                    const d = shape.getAttribute('d');
                    if (d) {
                        const coords = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
                        if (coords) {
                            for (let i = 0; i < coords.length; i += 2) {
                                if (!isNaN(coords[i]) && !isNaN(coords[i+1])) points.push({x: parseFloat(coords[i]), y: parseFloat(coords[i+1])});
                            }
                        }
                    }
                }

                let maxLen = 0;
                for (let i = 0; i < points.length - 1; i++) {
                    let dx = points[i+1].x - points[i].x;
                    let dy = points[i+1].y - points[i].y;
                    let len = Math.sqrt(dx*dx + dy*dy);
                    if (len > maxLen) {
                        maxLen = len;
                        intrinsicAngle = Math.atan2(dy, dx) * (180 / Math.PI);
                    }
                }
                weight = maxLen;
            }

            // Cộng dồn Transform từ CAD
            let accRot = 0;
            let curr = shape;
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

            if (weight > maxEdgeWeight) {
                maxEdgeWeight = weight;
                bestAngle = intrinsicAngle + accRot;
            }
        });

        const bbox = lot.getBBox();
        const centerX = bbox.x + bbox.width / 2;
        const centerY = bbox.y + bbox.height / 2;

        const prefixMatch = id.match(/^([a-zA-Z0-9]+)-/);
        const prefix = prefixMatch ? prefixMatch[1] : "UNKNOWN";

        lotMetrics[id] = {
            element: lot,
            angle: bestAngle,
            centerX: centerX,
            centerY: centerY,
            prefix: prefix,
            finalAngle: bestAngle // Mặc định ban đầu
        };
    });

    // ==========================================
    // BƯỚC 2: ĐỒNG THUẬN NHÓM THÔNG MINH (Sửa lỗi Tuyến Cong & Chữ L)
    // ==========================================
    const groups = {};
    for (let id in lotMetrics) {
        let p = lotMetrics[id].prefix;
        if (!groups[p]) groups[p] = [];
        groups[p].push(lotMetrics[id]);
    }

    for (let p in groups) {
        let siblings = groups[p];
        if (siblings.length < 2) continue;

        let angles = siblings.map(s => (s.angle % 180 + 180) % 180);
        
        // Tính độ lệch tiêu chuẩn (Variance) của các góc trong cùng 1 Block
        let minA = Math.min(...angles);
        let maxA = Math.max(...angles);
        let angleSpread = maxA - minA;
        if (angleSpread > 90) angleSpread = 180 - angleSpread; // Xử lý ranh giới vòng tròn

        // ĐỘT PHÁ: Nếu các lô trong lốc lệch nhau tổng thể > 15 độ 
        // -> Đây là đường cong hoặc lốc chữ L (như LK22A, LK09, LK28) -> BỎ QUA ÉP GÓC ĐỒNG ĐỀU
        const isCurvedOrLshape = angleSpread > 15;

        let targetAngle = angles[0];
        if (!isCurvedOrLshape) {
            // Nếu là lốc đường thẳng, tìm góc phổ biến nhất để đồng bộ làm mượt nét CAD
            let bins = {};
            angles.forEach(a => {
                let bin = Math.round(a / 15) * 15; 
                bins[bin] = (bins[bin] || 0) + 1;
            });
            targetAngle = parseInt(Object.keys(bins).reduce((a, b) => bins[a] > bins[b] ? a : b));
        }

        siblings.forEach(lot => {
            if (!isCurvedOrLshape) {
                let diff = Math.abs((lot.angle % 180) - targetAngle);
                if (diff > 90) diff = Math.abs(diff - 180);
                if (diff > 25) lot.angle = targetAngle; // Chỉ ép phẳng cho lốc đường thẳng
            }

            // Đọc dữ liệu điều chỉnh góc thủ công từ Google Sheet để đạt độ mỹ thuật 100%
            const info = dataBDS[lot.element.id];
            if (info && info.GocXoay !== undefined && info.GocXoay !== "" && info.GocXoay !== "-") {
                let manualOffset = parseFloat(info.GocXoay);
                if (!isNaN(manualOffset)) {
                    lot.angle += manualOffset; // Cộng thêm hoặc trừ bớt góc theo ý muốn
                }
            }
            
            // Chuẩn hóa góc chữ nằm trong khoảng dễ đọc (-90 đến 90 độ)
            let final = lot.angle % 180;
            if (final > 90) final -= 180;
            if (final <= -90) final += 180;
            lot.finalAngle = final;
        });
    }

    // ==========================================
    // BƯỚC 3: IN CHỮ VÀ GẮN SỰ KIỆN CLICK (Giữ nguyên)
    // ==========================================
    for (let id in lotMetrics) {
        let lot = lotMetrics[id];
        const info = dataBDS[id];

        const textLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
        textLabel.setAttribute("x", lot.centerX);
        textLabel.setAttribute("y", lot.centerY);
        textLabel.setAttribute("text-anchor", "middle");
        textLabel.setAttribute("dominant-baseline", "central");
        textLabel.setAttribute("class", "lot-label");
        textLabel.setAttribute("transform", `rotate(${lot.finalAngle} ${lot.centerX} ${lot.centerY})`);
        textLabel.textContent = id.replace(/^[A-Z]+/g, ''); // Đọc gọn nhãn chữ (Bỏ tiền tố chữ nếu muốn ngắn gọn, hoặc để nguyên 'id' tùy anh)
        textLabel.textContent = id; 
        lot.element.appendChild(textLabel);

        lot.element.addEventListener('click', function(e) {
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
            
            if (info.Loai.toLowerCase() === "đất nền") {
                constructInfo.style.display = "none";
            } else {
                constructInfo.style.display = "block";
                document.getElementById('sotang').innerText = info.ChieuCao;
                document.getElementById('dtxd').innerText = info.DienTichXD;
                document.getElementById('matdo').innerText = info.MatDo;
                document.getElementById('t1').innerText = info.Tang1;
                document.getElementById('t2').innerText = info.Tang2;
                document.getElementById('t3').innerText = info.Tang3;
                document.getElementById('t4').innerText = info.Tang4;
                document.getElementById('tongSan').innerText = info.TongSanXD;
            }

            infoBox.style.display = "block";
            if (window.innerWidth <= 768) {
                infoBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            e.stopPropagation(); 
        });
    }
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
