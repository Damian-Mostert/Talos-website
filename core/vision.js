// vision.js — browser visual cortex
//
// Browser sensory pipeline:
//
// Camera
//   ↓
// Canvas Retina
//   ↓
// Moondream Vision
//   ↓
// Spatial neuron mapping
//   ↓
// brain.perceiveVisual()
//
// Compatible with Next.js.

const OLLAMA_ENDPOINT =
    "http://127.0.0.1:11434/api/generate";

const VISION_MODEL = "moondream";

const GRID_W = 10;
const GRID_H = 10;



function hash32(value) {

    let h = value >>> 0;

    h = Math.imul(h,0x9e3779b1) >>> 0;
    h ^= h >>> 16;

    h = Math.imul(h,0x85ebca6b) >>> 0;
    h ^= h >>> 13;

    h = Math.imul(h,0xc2b2ae35) >>> 0;
    h ^= h >>> 16;

    return h >>> 0;
}



function pixelFeatureHash(r,g,b,x,y){

    return hash32(
        (r << 16) |
        (g << 8) |
        b ^
        ((x * 31 + y) & 0xffffffff)
    );

}



// ------------------------------------------------
// Browser camera
// ------------------------------------------------


export async function startCamera(video){


    if(
        typeof navigator === "undefined" ||
        !navigator.mediaDevices
    ){
        throw new Error(
            "Camera unavailable"
        );
    }


    const stream =
        await navigator.mediaDevices.getUserMedia({

            video:{
                width:320,
                height:240
            },

            audio:false
        });


    video.srcObject = stream;

    await video.play();


    return stream;

}



export function stopCamera(video){

    const stream =
        video?.srcObject;


    if(stream){

        stream
        .getTracks()
        .forEach(t=>t.stop());

    }

}



// ------------------------------------------------
// Capture retina
// ------------------------------------------------


export function captureFrame(video){


    const canvas =
        document.createElement(
            "canvas"
        );


    canvas.width = 320;
    canvas.height = 240;


    const ctx =
        canvas.getContext(
            "2d"
        );


    ctx.drawImage(
        video,
        0,
        0,
        320,
        240
    );


    return canvas;

}



export function canvasBytes(canvas){

    const ctx =
        canvas.getContext("2d");


    return ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
    );

}



// ------------------------------------------------
// Frame change detection
// ------------------------------------------------


function frameChanged(a,b,threshold=0.03){


    if(!a || !b)
        return true;


    const len =
        Math.min(
            a.length,
            b.length
        );


    let diff=0;


    for(
        let i=0;
        i<len;
        i+=50
    ){

        diff +=
            Math.abs(
                a[i]-b[i]
            );

    }


    return (
        diff/(len/50)
    ) >
    threshold*255;

}



// ------------------------------------------------
// Vision model
// ------------------------------------------------


async function describeFrame(imageData){


    const canvas =
        document.createElement(
            "canvas"
        );


    canvas.width =
        imageData.width;

    canvas.height =
        imageData.height;


    canvas
    .getContext("2d")
    .putImageData(
        imageData,
        0,
        0
    );


    const jpg =
        await new Promise(resolve=>{

            canvas.toBlob(
                resolve,
                "image/jpeg",
                .8
            );

        });


    const buffer =
        await jpg.arrayBuffer();


    const bytes =
        new Uint8Array(buffer);


    let binary="";

    bytes.forEach(
        b =>
        binary +=
        String.fromCharCode(b)
    );


    const b64 =
        btoa(binary);



    const response =
        await fetch(
            OLLAMA_ENDPOINT,
            {

            method:"POST",

            headers:{
                "Content-Type":
                "application/json"
            },


            body:JSON.stringify({

                model:VISION_MODEL,

                prompt:
`
Analyze this image.

Return ONLY JSON.

[
{
"label":"object",
"x":0.0,
"y":0.0,
"w":0.0,
"h":0.0,
"note":"description"
}
]
`,

                images:[
                    b64
                ],

                stream:false,
                keep_alive:'10m',
                options:{
                    num_ctx:1024,
                    num_predict:80,
                    temperature:0.1,
                    repeat_penalty:1.05
                }
            })

        });



    const data =
        await response.json();


    const text =
        data.response || "";


    try{

        const match =
            text.match(
                /\[[\s\S]*\]/
            );


        if(match)
            return JSON.parse(
                match[0]
            );


    }catch{}



    return [];

}



// ------------------------------------------------
// Spatial cortex
// ------------------------------------------------


export function spatialPattern(
    detections,
    regionSize
){

    const cellSize =
        Math.floor(
            regionSize /
            (GRID_W*GRID_H)
        );


    const indices =
        new Set();



    for(const det of detections){


        let labelHash=5381;


        for(
            let i=0;
            i<det.label.length;
            i++
        ){

            labelHash =
            (
                (labelHash<<5)
                +
                labelHash
            )
            ^
            det.label.charCodeAt(i);


            labelHash >>>=0;

        }



        const x1 =
            Math.floor(
                det.x*GRID_W
            );


        const y1 =
            Math.floor(
                det.y*GRID_H
            );


        const x2 =
            Math.min(
                GRID_W-1,
                Math.floor(
                    (det.x+det.w)
                    *
                    GRID_W
                )
            );


        const y2 =
            Math.min(
                GRID_H-1,
                Math.floor(
                    (det.y+det.h)
                    *
                    GRID_H
                )
            );



        for(
            let y=y1;
            y<=y2;
            y++
        ){

            for(
                let x=x1;
                x<=x2;
                x++
            ){

                const base =
                    (
                    y*GRID_W+x
                    )
                    *
                    cellSize;



                for(
                    let k=0;
                    k<12;
                    k++
                ){

                    indices.add(
                        base+
                        (
                        labelHash*
                        (k+1)*
                        2654435761
                        )
                        %
                        cellSize
                    );

                }

            }

        }

    }


    return new Uint32Array(
        [...indices]
    );

}



// ------------------------------------------------
// Retina
// ------------------------------------------------


export function retinaPattern(
    retina,
    width,
    height,
    regionSize
){

    if(!retina)
        return new Uint32Array(0);


    const indices =
        new Set();


    const cellSize =
        Math.floor(
            regionSize /
            100
        );


    for(
        let y=0;
        y<height;
        y++
    ){

        for(
            let x=0;
            x<width;
            x++
        ){

            const i =
            (
                y*width+x
            )*4;


            const hash =
                pixelFeatureHash(
                    retina[i],
                    retina[i+1],
                    retina[i+2],
                    x,
                    y
                );


            const cellX =
                Math.floor(
                    x/width*GRID_W
                );


            const cellY =
                Math.floor(
                    y/height*GRID_H
                );


            const base =
            (
                cellY*GRID_W+
                cellX
            )
            *
            cellSize;



            indices.add(
                base+
                hash%cellSize
            );

        }

    }


    return new Uint32Array(
        [...indices]
    );

}



// ------------------------------------------------
// Remaining sensory paths
// ------------------------------------------------


export function flowPattern(flow,regionSize){

    if(!flow)
        return new Uint32Array(0);


    const count =
        Math.min(
            64,
            Math.max(
                8,
                Math.round(
                    Math.hypot(
                        flow.x,
                        flow.y
                    )*40
                )
            )
        );


    const out=[];

    const seed =
        hash32(
            flow.x*1000 ^
            (flow.y*1000<<16)
        );


    for(
        let i=0;
        i<count;
        i++
    ){

        out.push(
            (
            seed+i*0x9e3779b1
            )
            %
            regionSize
        );

    }


    return new Uint32Array(out);

}



export function proprioceptionPattern(
    body,
    regionSize
){

    if(!body)
        return new Uint32Array(0);


    return new Uint32Array([
        hash32(body.x||0)%regionSize,
        hash32(body.y||0)%regionSize,
        hash32(body.speed||0)%regionSize
    ]);

}



export function objectsToPattern(
    objects,
    regionSize
){

    return spatialPattern(
        objects.map(
            o=>({
                label:o,
                x:.4,
                y:.4,
                w:.2,
                h:.2
            })
        ),
        regionSize
    );

}



// ------------------------------------------------
// Visual cortex controller
// ------------------------------------------------


export class VisualCortex{


constructor(video){

    this.video=video;

    this.running=false;

    this.previous=null;

    this.lastObjects=[];

    this.lastDetections=[];

}



async start(
    brain,
    onScene,
    intervalMs=800
){

    if(this.running)
        return;


    this.running=true;


    await startCamera(
        this.video
    );



    while(this.running){

        try{


            const canvas =
                captureFrame(
                    this.video
                );


            const frame =
                canvasBytes(
                    canvas
                );



            if(
                frameChanged(
                    this.previous,
                    frame.data
                )
            ){

                this.previous =
                    frame.data;


                const detections =
                    await describeFrame(
                        frame
                    );


                this.lastDetections =
                    detections;


                this.lastObjects =
                    detections.map(
                        x=>x.label
                    );



                if(
                    detections.length
                ){

                    brain.perceiveVisual(

                        spatialPattern(
                            detections,
                            brain.layout.visual.size
                        )

                    );

                }



                onScene?.({

                    detections,

                    objects:
                    this.lastObjects

                });

            }


        }catch(e){

            console.error(
                "Vision cortex:",
                e
            );

        }


        await new Promise(
            r=>setTimeout(
                r,
                intervalMs
            )
        );

    }

}



stop(){

    this.running=false;

    stopCamera(
        this.video
    );

}


}