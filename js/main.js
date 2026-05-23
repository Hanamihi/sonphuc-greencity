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

// Hàm xử lý bản đồ và tương tác (Phiên bản Tích hợp Transform Accumulator & PCA-lite)
function initMap() {
    document.querySelectorAll('svg g[id]').forEach(lot => {
        const id = lot.id;
        
        if (dataBDS[id]) {
            const info = dataBDS[id];
            lot.classList.add('lot-interactive');

            // Quét tất cả các nét tạo nên lô đất
            const allShapes = lot.querySelectorAll('rect, polygon, path, polyline, line');
            if (allShapes.length === 0) return;
            
            // Đổi màu Đã Bán cho toàn bộ các nét
            if (info.TrangThai === "Đã bán" || info.TrangThai === "Đã Bán") {
                allShapes.forEach(shape => {
                    shape.style.fill = "#7f8c8d"; 
                    shape.style.opacity = "0.8";  
                });
            }

            // --- THUẬT TOÁN TÌM GÓC ĐỘ CHUẨN XÁC ---
            let bestAngle = 0;
            let maxEdgeWeight = 0;

            allShapes.forEach(shape => {
                let tagName = shape.tagName.toLowerCase();
                let intrinsicAngle = 0;
                let weight = 0;

                // 1. Tìm góc nội tại của hình khối
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
                                if (!isNaN(coords[i]) && !isNaN(coords[i+1])) {
                                    points.push({x: coords[i], y: coords[i+1]});
                                }
                            }
                        }
                    } else if (tagName === 'path') {
                        const d = shape.getAttribute('d');
                        if (d) {
                            const coords = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
                            if (coords) {
                                for (let i = 0; i < coords.length; i += 2) {
                                    if (!isNaN(coords[i]) && !isNaN(coords[i+1])) {
                                        points.push({x: parseFloat(coords[i]), y: parseFloat(coords[i+1])});
                                    }
                                }
                            }
                        }
                    }

                    // ===== TÌM TRỤC CHÍNH CỦA HÌNH (PCA-LITE) =====
                    if (points.length >= 2) {
                        // Tính tâm
                        let meanX = 0;
                        let meanY = 0;
                        points.forEach(p => {
                            meanX += p.x;
                            meanY += p.y;
                        });
                        meanX /= points.length;
                        meanY /= points.length;

                        // Covariance matrix
                        let sxx = 0;
                        let syy = 0;
                        let sxy = 0;
                        points.forEach(p => {
                            let dx = p.x - meanX;
                            let dy = p.y - meanY;
                            sxx += dx * dx;
                            syy += dy * dy;
                            sxy += dx * dy;
                        });

                        // Góc principal axis
                        let theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
                        intrinsicAngle = theta * (180 / Math.PI);
                        
                        // Weight = độ trải dài
                        weight = Math.max(sxx, syy);
                    }
                }

                // 2. Cộng dồn góc bị xoay bởi thuộc tính Transform của CAD
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

                // 3. Quyết định góc cuối cùng
                if (weight > maxEdgeWeight) {
                    maxEdgeWeight = weight;
                    bestAngle = intrinsicAngle + accRot;
                }
            });

            // 4. Chuẩn hóa góc để người dùng không phải ngoái cổ đọc ngược
            let finalAngle = bestAngle % 180;
            if (finalAngle > 90) finalAngle -= 180;
            if (finalAngle < -90) finalAngle += 180; // Fix nhảy hướng

            // 5. Tính toán tâm lô đất và chèn chữ
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
