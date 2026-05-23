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

            const shape = lot.querySelector('rect, polygon, path, polyline'); 
            if (shape) {
                if (info.TrangThai === "Đã bán" || info.TrangThai === "Đã Bán") {
                    shape.style.fill = "#7f8c8d"; 
                    shape.style.opacity = "0.8";  
                }

                let textAngle = 0;
                let tagName = shape.tagName.toLowerCase();

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
                else {
                    let points = [];
                    
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

                    // TÌM TRỤC CHÍNH BẰNG CÁCH CỘNG GỘP CHIỀU DÀI (CÓ DUNG SAI GÓC)
                    if (points.length >= 3) {
                        let angleBuckets = []; 
                        
                        for (let i = 0; i < points.length; i++) {
                            let p1 = points[i];
                            if (tagName === 'polyline' && i === points.length - 1) break;
                            let p2 = points[(i + 1) % points.length];
                            
                            let dx = p2.x - p1.x;
                            let dy = p2.y - p1.y;
                            let length = Math.sqrt(dx*dx + dy*dy);
                            
                            // Nâng mức lọc nhiễu lên để loại bỏ các điểm node rác sinh ra từ CAD
                            if (length < 1.0) continue; 
                            
                            let angle = Math.atan2(dy, dx) * (180 / Math.PI);
                            
                            // Chuẩn hóa góc về khoảng 0 -> 179.99 độ
                            let normAngle = angle % 180;
                            if (normAngle < 0) normAngle += 180;
                            
                            let foundBucket = false;
                            for (let bucket of angleBuckets) {
                                let diff = Math.abs(normAngle - bucket.angle);
                                // Cân bằng sai số giữa góc xấp xỉ 0 độ và 180 độ
                                if (diff > 90) diff = 180 - diff; 
                                
                                // Áp dụng dung sai 5 độ để gom các đoạn thẳng song song bị gãy
                                if (diff <= 5) {
                                    bucket.sum += length;
                                    // Giữ lại góc của đoạn thẳng liền mạch dài nhất trong nhóm làm góc chuẩn
                                    if (length > bucket.maxLength) {
                                        bucket.angle = normAngle;
                                        bucket.maxLength = length;
                                    }
                                    foundBucket = true;
                                    break;
                                }
                            }
                            
                            if (!foundBucket) {
                                angleBuckets.push({ angle: normAngle, sum: length, maxLength: length });
                            }
                        }

                        // Chọn nhóm trục có tổng chiều dài các đoạn thẳng lớn nhất (chiều sâu lô)
                        let maxLen = 0;
                        for (let bucket of angleBuckets) {
                            if (bucket.sum > maxLen) {
                                maxLen = bucket.sum;
                                textAngle = bucket.angle;
                            }
                        }
                    }
                }

                // Đảo chiều chữ để luôn dễ đọc từ trái sang phải hoặc từ dưới lên trên
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
