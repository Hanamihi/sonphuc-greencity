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

// Hàm xử lý bản đồ và tương tác (Phiên bản Geometry Parser chuẩn xác)
function initMap() {
    document.querySelectorAll('svg g[id]').forEach(lot => {
        const id = lot.id;
        
        if (dataBDS[id]) {
            const info = dataBDS[id];
            lot.classList.add('lot-interactive');

            // 1. QUÉT TOÀN BỘ CÁC NÉT VẼ CẤU THÀNH LÔ ĐẤT (Đề phòng CAD xuất vỡ nét)
            const allShapes = lot.querySelectorAll('rect, polygon, path, polyline, line');
            
            // Đổi màu Đã Bán cho toàn bộ các nét
            if (info.TrangThai === "Đã bán" || info.TrangThai === "Đã Bán") {
                allShapes.forEach(shape => {
                    shape.style.fill = "#7f8c8d"; 
                    shape.style.opacity = "0.8";  
                });
            }

            let textAngle = 0;
            let angleBuckets = [];

            // Hàm phụ: Phân tích, tính chiều dài, góc và cộng dồn (Thuật toán Tolerance 6 độ)
            function addSegment(x1, y1, x2, y2) {
                let dx = x2 - x1;
                let dy = y2 - y1;
                let length = Math.sqrt(dx*dx + dy*dy);
                if (length < 0.5) return; // Loại bỏ nhiễu/rác vi điểm
                
                let angle = Math.atan2(dy, dx) * (180 / Math.PI);
                let normAngle = angle % 180;
                if (normAngle < 0) normAngle += 180;
                
                let found = false;
                for (let bucket of angleBuckets) {
                    let diff = Math.abs(normAngle - bucket.angle);
                    if (diff > 90) diff = 180 - diff;
                    
                    if (diff <= 6) { 
                        bucket.sum += length;
                        // Neo theo góc của đoạn thẳng dài nhất trong nhóm
                        if (length > bucket.maxLength) {
                            bucket.angle = normAngle;
                            bucket.maxLength = length;
                        }
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    angleBuckets.push({ angle: normAngle, sum: length, maxLength: length });
                }
            }

            let isRect = false;

            // 2. GIẢI MÃ TỌA ĐỘ ĐỂ TÌM TRỤC SÂU NHẤT CỦA LÔ
            allShapes.forEach(shape => {
                let tagName = shape.tagName.toLowerCase();

                // Dành cho hình chữ nhật nguyên khối
                if (tagName === 'rect' && angleBuckets.length === 0) {
                    isRect = true;
                    let baseAngle = 0;
                    const w = parseFloat(shape.getAttribute('width') || 0);
                    const h = parseFloat(shape.getAttribute('height') || 0);
                    if (h > w) baseAngle = -90; 
                    
                    const transform = shape.getAttribute('transform');
                    if (transform) {
                        if (transform.includes('rotate')) {
                            const match = transform.match(/rotate\(([-0-9.]+)/);
                            if (match) baseAngle += parseFloat(match[1]);
                        } else if (transform.includes('matrix')) {
                            const match = transform.match(/matrix\(([^)]+)\)/);
                            if (match) {
                                let vals = match[1].split(/[\s,]+/).map(parseFloat);
                                if (vals.length >= 6) {
                                    baseAngle += Math.atan2(vals[1], vals[0]) * (180 / Math.PI);
                                }
                            }
                        }
                    }
                    textAngle = baseAngle;
                } 
                // Dành cho nét thẳng rời rạc
                else if (tagName === 'line') {
                    addSegment(parseFloat(shape.getAttribute('x1')), parseFloat(shape.getAttribute('y1')),
                               parseFloat(shape.getAttribute('x2')), parseFloat(shape.getAttribute('y2')));
                }
                // Dành cho đa giác Polyline/Polygon
                else if (tagName === 'polygon' || tagName === 'polyline') {
                    const pointsStr = shape.getAttribute('points').trim().split(/[\s,]+/);
                    let pts = [];
                    for (let i = 0; i < pointsStr.length; i += 2) {
                        if (pointsStr[i] !== undefined && pointsStr[i+1] !== undefined) {
                            pts.push({x: parseFloat(pointsStr[i]), y: parseFloat(pointsStr[i+1])});
                        }
                    }
                    for (let i = 0; i < pts.length; i++) {
                        if (tagName === 'polyline' && i === pts.length - 1) break;
                        addSegment(pts[i].x, pts[i].y, pts[(i + 1) % pts.length].x, pts[(i + 1) % pts.length].y);
                    }
                }
                // Dành cho mảng Path phức tạp (Xử lý dứt điểm lệch chéo do Lệnh H, V, relative)
                else if (tagName === 'path') {
                    const d = shape.getAttribute('d');
                    let commands = d.match(/[a-zA-Z]|[-+]?[0-9]*\.?[0-9]+/g);
                    if (commands) {
                        let cx = 0, cy = 0, startX = 0, startY = 0;
                        let cmd = '';
                        for (let i = 0; i < commands.length; i++) {
                            let token = commands[i];
                            if (/[a-zA-Z]/.test(token)) {
                                cmd = token;
                                if (cmd.toUpperCase() === 'Z') {
                                    addSegment(cx, cy, startX, startY);
                                    cx = startX; cy = startY;
                                }
                            } else {
                                let nx = cx, ny = cy;
                                if (cmd === 'M' || cmd === 'L') {
                                    nx = parseFloat(token);
                                    ny = parseFloat(commands[++i]);
                                    if (cmd === 'M') { startX = nx; startY = ny; }
                                } else if (cmd === 'm' || cmd === 'l') {
                                    nx = cx + parseFloat(token);
                                    ny = cy + parseFloat(commands[++i]);
                                    if (cmd === 'm') { startX = nx; startY = ny; }
                                } else if (cmd === 'H') {
                                    nx = parseFloat(token);
                                } else if (cmd === 'h') {
                                    nx = cx + parseFloat(token);
                                } else if (cmd === 'V') {
                                    ny = parseFloat(token);
                                } else if (cmd === 'v') {
                                    ny = cy + parseFloat(token);
                                } else {
                                    continue; // Bỏ qua đường cong Bezier
                                }
                                
                                if (cmd !== 'M' && cmd !== 'm') {
                                    addSegment(cx, cy, nx, ny);
                                }
                                cx = nx; cy = ny;
                                if (cmd === 'M') cmd = 'L';
                                if (cmd === 'm') cmd = 'l';
                            }
                        }
                    }
                }
            });

            // 3. TÌM GÓC CỦA TRỤC DÀI NHẤT
            if (!isRect && angleBuckets.length > 0) {
                let maxLen = 0;
                for (let bucket of angleBuckets) {
                    if (bucket.sum > maxLen) {
                        maxLen = bucket.sum;
                        textAngle = bucket.angle;
                    }
                }
            }

            // Đảo chiều chữ để luôn dễ đọc từ trái sang phải hoặc từ dưới lên
            while (textAngle > 90) textAngle -= 180;
            while (textAngle <= -90) textAngle += 180;

            // 4. VẼ NHÃN VÀO TÂM LÔ ĐẤT
            const bbox = lot.getBBox();
            const centerX = bbox.x + bbox.width / 2;
            const centerY = bbox.y + bbox.height / 2;

            const textLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
            textLabel.setAttribute("x", centerX);
            textLabel.setAttribute("y", centerY);
            textLabel.setAttribute("text-anchor", "middle");
            textLabel.setAttribute("dominant-baseline", "middle");
            textLabel.setAttribute("class", "lot-label");
            textLabel.setAttribute("transform", `rotate(${textAngle} ${centerX} ${centerY})`);
            textLabel.textContent = id; 
            lot.appendChild(textLabel);

            // --- SỰ KIỆN CLICK MỞ POPUP DỮ LIỆU ---
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
