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

// Hàm xử lý bản đồ và tương tác
function initMap() {
    document.querySelectorAll('svg g[id]').forEach(lot => {
        const id = lot.id;
        
        if (dataBDS[id]) {
            const info = dataBDS[id];
            lot.classList.add('lot-interactive');

            // --- TẠO NHÃN TÊN VÀ ĐỔI MÀU ---
            // Bổ sung tìm kiếm cả polyline và path để vét cạn mọi kiểu xuất CAD
            const shape = lot.querySelector('rect, polygon, path, polyline'); 
            if (shape) {
                // Tô màu xám nếu Đã bán
                if (info.TrangThai === "Đã bán" || info.TrangThai === "Đã Bán") {
                    shape.style.fill = "#7f8c8d"; 
                    shape.style.opacity = "0.8";  
                }

                let textAngle = 0;
                let tagName = shape.tagName.toLowerCase();

                // 1. Nếu là dạng hình chữ nhật (Rect)
                if (tagName === 'rect') {
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
                            // Đọc góc xoay nếu file bị biến đổi qua Illustrator
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
                // 2. Nếu là dạng đa giác (Polygon), đường gấp khúc (Polyline) hoặc nét vẽ (Path)
                else {
                    let points = [];
                    
                    // Lấy tọa độ các đỉnh
                    if (tagName === 'polygon' || tagName === 'polyline') {
                        const pointsStr = shape.getAttribute('points').trim().split(/[\s,]+/);
                        for (let i = 0; i < pointsStr.length; i += 2) {
                            if (pointsStr[i] !== undefined && pointsStr[i+1] !== undefined) {
                                points.push({x: parseFloat(pointsStr[i]), y: parseFloat(pointsStr[i+1])});
                            }
                        }
                    } else if (tagName === 'path') {
                        const d = shape.getAttribute('d');
                        const coords = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
                        if (coords) {
                            for (let i = 0; i < coords.length; i += 2) {
                                if (coords[i+1] !== undefined) {
                                    points.push({x: parseFloat(coords[i]), y: parseFloat(coords[i+1])});
                                }
                            }
                        }
                    }

                    // TÌM TRỤC CHÍNH BẰNG CÁCH CỘNG GỘP CHIỀU DÀI
                    if (points.length >= 3) {
                        let angleBuckets = {}; 
                        let maxLen = 0;
                        
                        for (let i = 0; i < points.length; i++) {
                            let p1 = points[i];
                            // Bỏ qua đoạn nối điểm cuối về điểm đầu nếu là polyline hở
                            if (tagName === 'polyline' && i === points.length - 1) break;
                            
                            let p2 = points[(i + 1) % points.length];
                            
                            let dx = p2.x - p1.x;
                            let dy = p2.y - p1.y;
                            let length = Math.sqrt(dx*dx + dy*dy);
                            
                            if (length < 0.1) continue; // Bỏ qua các nét vẽ nhiễu li ti
                            
                            let angle = Math.atan2(dy, dx) * (180 / Math.PI);
                            
                            // Chuẩn hóa góc về khoảng 0 -> 179 độ để gộp các đường thẳng song song
                            let normAngle = angle;
                            while (normAngle < 0) normAngle += 180;
                            while (normAngle >= 180) normAngle -= 180;
                            
                            // Làm tròn góc để tạo nhóm
                            let rounded = Math.round(normAngle);
                            if (rounded === 180) rounded = 0;
                            
                            if (!angleBuckets[rounded]) {
                                angleBuckets[rounded] = { sum: 0, exactAngle: angle };
                            }
                            
                            // Cộng dồn chiều dài vào nhóm góc tương ứng
                            angleBuckets[rounded].sum += length;
                            
                            // Cập nhật góc có tổng chiều dài lớn nhất
                            if (angleBuckets[rounded].sum > maxLen) {
                                maxLen = angleBuckets[rounded].sum;
                                textAngle = angleBuckets[rounded].exactAngle;
                            }
                        }
                    }
                }

                // Chỉnh lại góc để chữ không bị lộn ngược
                while (textAngle > 90) textAngle -= 180;
                while (textAngle <= -90) textAngle += 180;

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
            }

            // --- SỰ KIỆN CLICK MỞ POPUP ---
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
