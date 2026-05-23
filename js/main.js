const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwHK0oo4SHviMpKj9yZ_tOnA61JwSMjh1x3Ds_yhsUxYYZEchzXAdzNwQtEqSYdwU5aig/exec";

let dataBDS = {};
const infoBox = document.getElementById('info-box');


// ======================================================
// LOAD SVG + DATA
// ======================================================

Promise.all([
    fetch('assets/svg/map.svg').then(r => r.text()),
    fetch(SCRIPT_URL).then(r => r.json())
])

.then(([svgContent, data]) => {

    document.getElementById('map-wrapper').innerHTML = svgContent;

    dataBDS = data;

    console.log("Đã tải dữ liệu và bản đồ thành công!");

    initMap();
    initZoom();
})

.catch(error => {

    console.error("Lỗi khởi tạo:", error);

    alert("Không thể tải dữ liệu hoặc bản đồ!");
});


// ======================================================
// HELPERS
// ======================================================

// Parse transform matrix thật sự
function getGlobalTransform(el) {

    let matrix = new DOMMatrix();

    while (el && el instanceof SVGElement) {

        const tf = el.transform?.baseVal;

        if (tf && tf.numberOfItems > 0) {

            for (let i = 0; i < tf.numberOfItems; i++) {

                matrix = tf.getItem(i).matrix.multiply(matrix);
            }
        }

        el = el.parentNode;
    }

    return matrix;
}


// Transform point theo matrix
function transformPoint(x, y, matrix) {

    const pt = new DOMPoint(x, y);

    return pt.matrixTransform(matrix);
}


// ======================================================
// INIT MAP
// ======================================================

function initMap() {

    document.querySelectorAll('svg g[id]').forEach(lot => {

        const id = lot.id;

        if (!dataBDS[id]) return;

        const info = dataBDS[id];

        lot.classList.add('lot-interactive');


        // ==========================================
        // SHAPES
        // ==========================================

        const allShapes = lot.querySelectorAll(
            'polygon, polyline, rect'
        );

        if (allShapes.length === 0) return;


        // ==========================================
        // COLOR SOLD LOT
        // ==========================================

        if (
            info.TrangThai === "Đã bán" ||
            info.TrangThai === "Đã Bán"
        ) {

            allShapes.forEach(shape => {

                shape.style.fill = "#7f8c8d";
                shape.style.opacity = "0.8";
            });
        }


        // ==========================================
        // COLLECT ALL WORLD POINTS
        // ==========================================

        let allPoints = [];

        allShapes.forEach(shape => {

            const tag = shape.tagName.toLowerCase();

            const matrix = getGlobalTransform(shape);


            // ======================================
            // RECT
            // ======================================

            if (tag === 'rect') {

                const x = parseFloat(shape.getAttribute('x') || 0);
                const y = parseFloat(shape.getAttribute('y') || 0);

                const w = parseFloat(shape.getAttribute('width') || 0);
                const h = parseFloat(shape.getAttribute('height') || 0);

                [
                    [x, y],
                    [x + w, y],
                    [x + w, y + h],
                    [x, y + h]
                ]

                .forEach(([px, py]) => {

                    const p = transformPoint(px, py, matrix);

                    allPoints.push({
                        x: p.x,
                        y: p.y
                    });
                });
            }


            // ======================================
            // POLYGON / POLYLINE
            // ======================================

            else if (
                tag === 'polygon' ||
                tag === 'polyline'
            ) {

                const pts = shape.points;

                for (let i = 0; i < pts.numberOfItems; i++) {

                    const pt = pts.getItem(i);

                    const p = transformPoint(
                        pt.x,
                        pt.y,
                        matrix
                    );

                    allPoints.push({
                        x: p.x,
                        y: p.y
                    });
                }
            }
        });


        if (allPoints.length < 2) return;


        // ==========================================
        // PCA
        // ==========================================

        let meanX = 0;
        let meanY = 0;

        allPoints.forEach(p => {

            meanX += p.x;
            meanY += p.y;
        });

        meanX /= allPoints.length;
        meanY /= allPoints.length;


        let sxx = 0;
        let syy = 0;
        let sxy = 0;

        allPoints.forEach(p => {

            const dx = p.x - meanX;
            const dy = p.y - meanY;

            sxx += dx * dx;
            syy += dy * dy;
            sxy += dx * dy;
        });


        let angle = 0.5 * Math.atan2(
            2 * sxy,
            sxx - syy
        );

        let finalAngle = angle * 180 / Math.PI;


        // ==========================================
        // NORMALIZE ANGLE
        // ==========================================

        finalAngle = finalAngle % 180;

        if (finalAngle > 90)
            finalAngle -= 180;

        if (finalAngle < -90)
            finalAngle += 180;


        // ==========================================
        // BBOX
        // ==========================================

        const bbox = lot.getBBox();

        const centerX = bbox.x + bbox.width / 2;
        const centerY = bbox.y + bbox.height / 2;


        // ==========================================
        // FONT SIZE AUTO
        // ==========================================

        const fontSize = Math.max(
            8,
            Math.min(bbox.width, bbox.height) * 0.22
        );


        // ==========================================
        // CREATE LABEL
        // ==========================================

        const textLabel = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "text"
        );

        textLabel.setAttribute("x", centerX);

        textLabel.setAttribute("y", centerY);

        textLabel.setAttribute(
            "text-anchor",
            "middle"
        );

        textLabel.setAttribute(
            "dominant-baseline",
            "middle"
        );

        textLabel.setAttribute(
            "class",
            "lot-label"
        );

        textLabel.setAttribute(
            "font-size",
            fontSize
        );

        textLabel.setAttribute(
            "transform",
            `rotate(${finalAngle} ${centerX} ${centerY})`
        );

        textLabel.textContent = id;

        lot.appendChild(textLabel);


        // ==========================================
        // CLICK EVENT
        // ==========================================

        lot.addEventListener('click', function(e) {

            document.getElementById('malo').innerText =
                "Lô: " + id;

            const statusEl =
                document.getElementById('trangThai');

            statusEl.innerText = info.TrangThai;

            if (info.TrangThai === "Đang bán") {

                statusEl.style.color = "#27ae60";
            }

            else if (
                info.TrangThai === "Đã bán" ||
                info.TrangThai === "Đã Bán"
            ) {

                statusEl.style.color = "#e74c3c";
            }

            else {

                statusEl.style.color = "#f39c12";
            }


            document.getElementById('loai').innerText =
                info.Loai;

            document.getElementById('dientich').innerText =
                info.DienTichLo;


            const constructInfo =
                document.getElementById('construction-info');


            if (
                info.Loai.toLowerCase() === "đất nền"
            ) {

                constructInfo.style.display = "none";
            }

            else {

                constructInfo.style.display = "block";

                document.getElementById('sotang').innerText =
                    info.ChieuCao;

                document.getElementById('dtxd').innerText =
                    info.DienTichXD;

                document.getElementById('matdo').innerText =
                    info.MatDo;

                document.getElementById('t1').innerText =
                    info.Tang1;

                document.getElementById('t2').innerText =
                    info.Tang2;

                document.getElementById('t3').innerText =
                    info.Tang3;

                document.getElementById('t4').innerText =
                    info.Tang4;

                document.getElementById('tongSan').innerText =
                    info.TongSanXD;
            }


            infoBox.style.display = "block";


            if (window.innerWidth <= 768) {

                infoBox.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest'
                });
            }

            e.stopPropagation();
        });
    });
}


// ======================================================
// CLOSE POPUP
// ======================================================

document.addEventListener('click', function() {

    infoBox.style.display = "none";
});

infoBox.addEventListener('click', function(e) {

    e.stopPropagation();
});


// ======================================================
// ZOOM
// ======================================================

function initZoom() {

    var eventsHandler = {

        haltEventListeners: [
            'touchstart',
            'touchend',
            'touchmove',
            'touchleave',
            'touchcancel'
        ],

        init: function(options) {

            var instance = options.instance;

            var initialScale = 1;

            var pannedX = 0;
            var pannedY = 0;

            this.hammer = new Hammer(
                options.svgElement,
                {
                    recognizers: [
                        [
                            Hammer.Pan,
                            {
                                direction:
                                Hammer.DIRECTION_ALL
                            }
                        ],
                        [
                            Hammer.Pinch,
                            {
                                enable: true
                            }
                        ]
                    ]
                }
            );

            this.hammer.on(
                'panstart panmove',
                function(ev){

                    if (ev.type === 'panstart') {

                        pannedX = 0;
                        pannedY = 0;
                    }

                    instance.panBy({
                        x: ev.deltaX - pannedX,
                        y: ev.deltaY - pannedY
                    });

                    pannedX = ev.deltaX;
                    pannedY = ev.deltaY;
                }
            );

            this.hammer.on(
                'pinchstart pinchmove',
                function(ev){

                    if (ev.type === 'pinchstart') {

                        initialScale =
                            instance.getZoom();
                    }

                    instance.zoomAtPoint(
                        initialScale * ev.scale,
                        {
                            x: ev.center.x,
                            y: ev.center.y
                        }
                    );
                }
            );
        },

        destroy: function(){

            this.hammer.destroy();
        }
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