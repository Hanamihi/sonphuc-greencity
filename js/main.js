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

// Hàm xử lý bản đồ và tương tác (Phiên bản tích hợp Thuật toán hàng xóm KNN)
function initMap() {
    let lotsData = []; // Mảng lưu trữ dữ liệu tính toán tạm thời

    // BƯỚC 1: QUÉT VÀ TÍNH TOÁN GÓC THÔ CHO TẤT CẢ CÁC LÔ
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

            let bestAngle = 0;
            let maxEdgeWeight = 0;

            allShapes.forEach(shape => {
                let tagName = shape.tagName.toLowerCase();
                let intrinsicAngle = 0;
                let weight = 0;

                // Tính góc nội tại của hình khối
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

                    // Tìm cạnh dài nhất của đa giác
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

                // Cộng dồn góc xoay từ thẻ Group (Transform Accumulator)
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

            // Chuẩn hóa góc về mốc -90 đến 90 độ
            let finalAngle = bestAngle % 180;
            if (finalAngle > 90) finalAngle -= 180;
            if (finalAngle <= -90) finalAngle += 180;

            const bbox = lot.getBBox();
            const cx = bbox.x + bbox.width / 2;
            const cy = bbox.y + bbox.height / 2;
            
            // Lấy tên phân khu (Ví dụ: từ LK22A-06 lấy ra chữ LK22A)
            const prefix = id.split('-')[0];

            // Lưu vào mảng để chuẩn bị đối chiếu hàng xóm
            lotsData.push({ id, lot, info, angle: finalAngle, cx, cy, prefix });
        }
    });

    // BƯỚC 2: THUẬT TOÁN ĐỒNG BỘ GÓC THEO SỐ ĐÔNG HÀNG XÓM (KNN)
    lotsData.forEach(item => {
        // Lọc ra các lô đất cùng phân khu (cùng prefix)
        let neighbors = lotsData.filter(other => other.prefix === item.prefix && other.id !== item.id);
        
        if (neighbors.length > 0) {
            // Sắp xếp để tìm ra những lô ở gần vị trí vật lý nhất
            neighbors.sort((a, b) => {
                let distA = Math.hypot(a.cx - item.cx, a.cy - item.cy);
                let distB = Math.hypot(b.cx - item.cx, b.cy - item.cy);
                return distA - distB;
            });

            // Lấy 3 hàng xóm gần sát vách nhất
            let closest = neighbors.slice(0, 3);
            
            // Đếm số hàng xóm có góc bị lệch ~90 độ so với lô hiện tại
            let flipVotes = 0;
            closest.forEach(n => {
                let diff = Math.abs(item.angle - n.angle) % 180;
                if (diff > 90) diff = 180 - diff;
                if (diff > 45) flipVotes++; // Lệch trên 45 độ được xem là trục ngang
            });

            // Nếu quá nửa số hàng xóm gần nhất (2/3) quay hướng khác, ta sẽ bẻ góc 90 độ theo họ
            if (flipVotes >= Math.ceil(closest.length / 2.0)) {
                item.angle += 90;
                // Chuẩn hóa lại góc sau khi bẻ
                item.angle = item.angle % 180;
                if (item.angle > 90) item.angle -= 180;
                if (item.angle <= -90) item.angle += 180;
            }
        }
    });

    // BƯỚC 3: IN CHỮ VÀ GẮN SỰ KIỆN CLICK (Áp dụng góc đã làm mịn)
    lotsData.forEach(item => {
        const textLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
        textLabel.setAttribute("x", item.cx);
        textLabel.setAttribute("y", item.cy);
        textLabel.setAttribute("text-anchor", "middle");
        textLabel.setAttribute("dominant-baseline", "middle");
        textLabel.setAttribute("class", "lot-label");
        textLabel.setAttribute("transform", `rotate(${item.angle} ${item.cx} ${item.cy})`);
        textLabel.textContent = item.id; 
        item.lot.appendChild(textLabel);

        // Sự kiện click hiện bảng thông tin
        item.lot.addEventListener('click', function(e) {
            document.getElementById('malo').innerText = "Lô: " + item.id;
            
            const statusEl = document.getElementById('trangThai');
            statusEl.innerText = item.info.TrangThai; 
            if (item.info.TrangThai === "Đang bán") {
                statusEl.style.color = "#27ae60"; 
            } else if (item.info.TrangThai === "Đã bán" || item.info.TrangThai === "Đã Bán") {
                statusEl.style.color = "#e74c3c"; 
            } else {
                statusEl.style.color = "#f39c12"; 
            }

            document.getElementById('loai').innerText = item.info.Loai;
            document.getElementById('dientich').innerText = item.info.DienTichLo;
            
            const constructInfo = document.getElementById('construction-info');
            
            if (item.info.Loai.toLowerCase() === "đất nền") {
                constructInfo.style.display = "none";
            } else {
                constructInfo.style.display = "block";
                document.getElementById('sotang').innerText = item.info.ChieuCao;
                document.getElementById('dtxd').innerText = item.info.DienTichXD;
                document.getElementById('matdo').innerText = item.info.MatDo;
                document.getElementById('t1').innerText = item.info.Tang1;
                document.getElementById('t2').innerText = item.info.Tang2;
                document.getElementById('t3').innerText = item.info.Tang3;
                document.getElementById('t4').innerText = item.info.Tang4;
                document.getElementById('tongSan').innerText = item.info.TongSanXD;
            }

            infoBox.style.display = "block";
            if (window.innerWidth <= 768) {
                infoBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            e.stopPropagation(); 
        });
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
