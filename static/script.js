console.log("Script carregado!");

const robo = document.querySelector(".robo");
const area = document.querySelector(".area-robo");


robo.style.left = "50px";
robo.style.top = "50px";

let x = 0;
let y = 0;
let theta = 0;

const r = 0.195 / 2;
const l = 0.381 / 2;

const wl = 30 * Math.PI / 180;
const wr = 60 * Math.PI / 180;

const dt = 0.25;

let v = 0; // Velocidade linear (m/s)
let w = 0; // Velocidade angular (rad/s)

const escala = 300; // pixels por metro

window.addEventListener("atualizarVelocidadesRobo", (evento) => {
    v = evento.detail.v;
    w = evento.detail.w;
});

function atualizarRobo() {

    // Atualiza a posição e a orientação
    x += v * Math.cos(theta) * dt;
    y += v * Math.sin(theta) * dt;
    theta += w * dt;

    const larguraArea = area.clientWidth;
    const alturaArea = area.clientHeight;

    const metadeLargura = robo.offsetWidth / 2;
    const metadeAltura = robo.offsetHeight / 2;

    // Margem que mantém o robô inteiro dentro da área
    const margem = Math.hypot(metadeLargura, metadeAltura);

    let posX = larguraArea / 2 + x * escala;
    let posY = alturaArea / 2 - y * escala;

    // Limites considerando a rotação
    posX = Math.max(
        margem,
        Math.min(posX, larguraArea - margem)
    );

    posY = Math.max(
        margem,
        Math.min(posY, alturaArea - margem)
    );

    robo.style.left = `${posX}px`;
    robo.style.top = `${posY}px`;
    robo.style.transform =
        `translate(-50%, -50%) rotate(${theta}rad)`;
    
    window.dispatchEvent(new CustomEvent("atualizarGraficosRobo", {
        detail: {
            v: v,
            w: w
        }
    }));
}

setInterval(atualizarRobo, dt * 1000);