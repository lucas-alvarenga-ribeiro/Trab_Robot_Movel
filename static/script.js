/* Motor da simulação em tempo real (tela única).
 *
 * O cálculo e o desenho são separados para a animação ficar fluida:
 *   - produtor: pede ao servidor (/api/robo/passo) os próximos trechos do
 *     movimento, com as poses intermediárias, e guarda num buffer que fica
 *     um pouco à frente do relógio da simulação;
 *   - animação: a cada quadro da tela (requestAnimationFrame, ~60 fps) avança
 *     o relógio e interpola a pose entre as amostras do buffer.
 *
 * O comando vem de uma de duas fontes:
 *   - controle manual  (evento "atualizarVelocidadesRobo" {v, w, rodas})
 *   - trajetória       (evento "executarTrajetoriaRobo" {segmentos})
 */
(function () {
    "use strict";

    // O tamanho de cada pedido ao servidor e a folga do buffer se adaptam à
    // latência medida: pedidos lentos → trechos maiores, para nunca faltar pose.
    const TRECHO_MIN = 0.1;      // s de relógio (× fator)
    const TRECHO_MAX = 1.0;
    const PERIODO_INFO = 0.1;    // atualização de texto e gráficos (s de relógio)
    const MAX_RASTRO = 20000;    // pontos guardados por rastro
    const DIST_RASTRO = 0.002;   // distância mínima entre pontos do rastro (m)
    const VISTA_MINIMA = 3;      // largura mínima mostrada (m)

    const canvas = document.getElementById("pr-mundo");
    const ctx = canvas.getContext("2d");
    const botaoPausar = document.getElementById("pr-pausar");
    const seletorFator = document.getElementById("pr-fator");
    const saidaEstado = document.getElementById("pr-estado-tempo-real");
    const saidaTrajetoria = document.getElementById("pr-estado-trajetoria");

    let estado;                  // pose mostrada, rastros e limites
    let buffer;                  // amostras {t, real, odometria, cmd}; buffer[0] é a última já passada
    let comando = { v: 0, w: 0, rodas: null };
    let fila = [];               // segmentos restantes da trajetória (consumidos pelo produtor)
    let trajetoriaEmCurso = false;
    let pausado = false;
    let geracao = 0;             // descarta respostas que chegam depois de reiniciar/mudar comando
    let vista = null;            // vista atual (suavizada)
    let latencia = 0.1;          // média móvel do tempo de resposta do servidor (s)

    const trecho = () => Math.min(TRECHO_MAX, Math.max(TRECHO_MIN, 2 * latencia));
    const antecedencia = () => trecho() + latencia + 0.1;

    const fator = () => Number(seletorFator.value);
    const ultima = () => buffer[buffer.length - 1];

    function amostra(t, real, odometria, cmd) {
        return { t, real: real.slice(), odometria: odometria.slice(), cmd };
    }

    // ------------------------------------------------------------------ //
    // Controle
    // ------------------------------------------------------------------ //
    function reiniciar() {
        geracao++;
        estado = {
            t: 0,
            poseReal: [0, 0, 0],
            poseOdometria: [0, 0, 0],
            rastroReal: [[0, 0]],
            rastroOdometria: [[0, 0]],
            limites: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
        };
        buffer = [amostra(0, [0, 0, 0], [0, 0, 0], { v: 0, w: 0, rodas: null })];
        comando = { v: 0, w: 0, rodas: null };
        fila = [];
        trajetoriaEmCurso = false;
        vista = null;
        saidaTrajetoria.textContent = "";
        window.dispatchEvent(new CustomEvent("reiniciarRobo"));
        mostrarEstado();
    }

    // Descarta o que foi calculado à frente, para um novo comando valer na hora
    function cortarBuffer() {
        geracao++;
        buffer = [amostra(estado.t, estado.poseReal, estado.poseOdometria, comando)];
    }

    function definirPausa(valor) {
        pausado = valor;
        botaoPausar.textContent = pausado ? "▶ Continuar" : "⏸ Pausar";
    }

    window.addEventListener("atualizarVelocidadesRobo", (evento) => {
        // Comando manual interrompe uma trajetória em andamento
        saidaTrajetoria.textContent = trajetoriaEmCurso ? "Trajetória interrompida pelo controle manual." : "";
        fila = [];
        trajetoriaEmCurso = false;
        comando = {
            v: evento.detail.v,
            w: evento.detail.w,
            rodas: evento.detail.rodas || null,
        };
        cortarBuffer();
        definirPausa(false);
    });

    window.addEventListener("executarTrajetoriaRobo", (evento) => {
        // Toda trajetória parte da origem, para comparar real × odometria
        reiniciar();
        fila = evento.detail.segmentos.map((s) => ({
            v: Number(s.v), w: Number(s.w), restante: Number(s.duracao),
        })).filter((s) => s.restante > 0);
        trajetoriaEmCurso = fila.length > 0;
        const total = fila.reduce((soma, s) => soma + s.restante, 0);
        saidaTrajetoria.textContent = `Executando trajetória (${total.toFixed(1)} s simulados)…`;
        definirPausa(false);
    });

    botaoPausar.addEventListener("click", () => definirPausa(!pausado));
    document.getElementById("pr-reiniciar").addEventListener("click", reiniciar);

    // ------------------------------------------------------------------ //
    // Produtor: calcula trechos à frente do relógio
    // ------------------------------------------------------------------ //
    function comandoNulo(c) {
        if (c.rodas) return c.rodas.w_d === 0 && c.rodas.w_e === 0;
        return c.v === 0 && c.w === 0;
    }

    async function pedirTrecho(inicio, cmd, dt) {
        const painel = window.ParametrosRobo;
        const inicioPedido = performance.now();
        const resposta = await fetch("/api/robo/passo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                parametros: painel.obterParametros(),
                modelo: painel.obterModelo(),
                pose_real: inicio.real,
                pose_odometria: inicio.odometria,
                dt: dt,
                ...(cmd.rodas ? cmd.rodas : { v: cmd.v, w: cmd.w }),
            }),
        });
        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(dados.erro || "Falha no passo da simulação");
        latencia = 0.7 * latencia + 0.3 * (performance.now() - inicioPedido) / 1000;
        return dados.amostras.map((a) => amostra(inicio.t + a.t, a.real, a.odometria, cmd));
    }

    async function produzir() {
        const fim = ultima();
        if (pausado || fim.t - estado.t >= antecedencia() * fator()) return false;

        const segmento = fila[0];
        const cmd = segmento ? { v: segmento.v, w: segmento.w, rodas: null } : comando;
        if (!segmento && comandoNulo(cmd)) return false;  // parado: nada a calcular

        let dt = trecho() * fator();
        if (segmento) dt = Math.min(dt, segmento.restante);

        let novas;
        if (comandoNulo(cmd)) {
            // Segmento parado (v = ω = 0) só consome tempo
            novas = [amostra(fim.t + dt, fim.real, fim.odometria, cmd)];
        } else {
            const minhaGeracao = geracao;
            novas = await pedirTrecho(fim, cmd, dt);
            if (minhaGeracao !== geracao) return true;  // comando mudou enquanto calculava
        }

        buffer.push(...novas);
        if (segmento) {
            segmento.restante -= dt;
            if (segmento.restante <= 1e-9) fila.shift();
        }
        return true;
    }

    async function cicloProdutor() {
        let espera = 16;
        try {
            espera = (await produzir()) ? 0 : 16;
        } catch (erro) {
            saidaTrajetoria.textContent = erro.message;
            console.error(erro);
            espera = 500;
        }
        setTimeout(cicloProdutor, espera);
    }

    // ------------------------------------------------------------------ //
    // Animação: avança o relógio e interpola a pose a cada quadro
    // ------------------------------------------------------------------ //
    function interpolarAngulo(a, b, f) {
        const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
        return a + d * f;
    }

    function interpolarPose(a, b, f) {
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, interpolarAngulo(a[2], b[2], f)];
    }

    function adicionarAoRastro(rastro, pose) {
        const [ux, uy] = rastro[rastro.length - 1];
        if (Math.hypot(pose[0] - ux, pose[1] - uy) < DIST_RASTRO) return;
        rastro.push([pose[0], pose[1]]);
        if (rastro.length > MAX_RASTRO) rastro.shift();
        const l = estado.limites;
        l.minX = Math.min(l.minX, pose[0]); l.maxX = Math.max(l.maxX, pose[0]);
        l.minY = Math.min(l.minY, pose[1]); l.maxY = Math.max(l.maxY, pose[1]);
    }

    function avancarRelogio(dtRelogio) {
        if (!pausado) {
            estado.t = Math.min(estado.t + dtRelogio * fator(), ultima().t);
        }

        // Amostras já ultrapassadas entram no rastro
        while (buffer.length > 1 && buffer[1].t <= estado.t) {
            buffer.shift();
            adicionarAoRastro(estado.rastroReal, buffer[0].real);
            adicionarAoRastro(estado.rastroOdometria, buffer[0].odometria);
        }

        const [a, b] = buffer;
        if (b) {
            const f = (estado.t - a.t) / (b.t - a.t);
            estado.poseReal = interpolarPose(a.real, b.real, f);
            estado.poseOdometria = interpolarPose(a.odometria, b.odometria, f);
        } else {
            estado.poseReal = a.real.slice();
            estado.poseOdometria = a.odometria.slice();
        }

        if (trajetoriaEmCurso && !fila.length && buffer.length === 1) {
            trajetoriaEmCurso = false;
            concluirTrajetoria();
        }
    }

    function erroOdometria() {
        const [xr, yr, tr] = estado.poseReal;
        const [xo, yo, to] = estado.poseOdometria;
        return { posicao: Math.hypot(xr - xo, yr - yo), orientacao: Math.atan2(Math.sin(tr - to), Math.cos(tr - to)) };
    }

    function concluirTrajetoria() {
        const e = erroOdometria();
        saidaTrajetoria.textContent =
            `Trajetória concluída em ${estado.t.toFixed(2)} s | erro real × odometria: ` +
            `${(e.posicao * 100).toFixed(2)} cm, ${(e.orientacao * 180 / Math.PI).toFixed(2)}°`;
    }

    function mostrarEstado() {
        const [x, y, theta] = estado.poseReal;
        saidaEstado.textContent =
            `t = ${estado.t.toFixed(1)} s | pose real: x = ${x.toFixed(2)} m, y = ${y.toFixed(2)} m, ` +
            `θ = ${(theta * 180 / Math.PI).toFixed(1)}° | erro da odometria: ` +
            `${(erroOdometria().posicao * 100).toFixed(1)} cm`;
    }

    function comandoMostrado() {
        if (buffer.length > 1) return buffer[1].cmd;
        return fila[0] ? { v: fila[0].v, w: fila[0].w } : comando;
    }

    let ultimoQuadro = null;
    let acumuladoInfo = 0;

    function quadro(agora) {
        const dtRelogio = ultimoQuadro === null ? 0 : Math.min((agora - ultimoQuadro) / 1000, 0.1);
        ultimoQuadro = agora;

        avancarRelogio(dtRelogio);
        desenhar(dtRelogio);

        // Texto e gráficos não precisam de 60 fps
        acumuladoInfo += dtRelogio;
        if (acumuladoInfo >= PERIODO_INFO) {
            acumuladoInfo %= PERIODO_INFO;
            mostrarEstado();
            if (!pausado) {
                const cmd = comandoMostrado();
                window.dispatchEvent(new CustomEvent("atualizarGraficosRobo", {
                    detail: { v: cmd.v, w: cmd.w },
                }));
            }
        }
        requestAnimationFrame(quadro);
    }

    // ------------------------------------------------------------------ //
    // Desenho (coordenadas do mundo em metros, eixo y para cima)
    // ------------------------------------------------------------------ //
    function ajustarResolucao() {
        const dpr = window.devicePixelRatio || 1;
        const largura = Math.round(canvas.clientWidth * dpr);
        const altura = Math.round(canvas.clientHeight * dpr);
        if (canvas.width !== largura || canvas.height !== altura) {
            canvas.width = largura;
            canvas.height = altura;
        }
    }

    function vistaAlvo() {
        const l = estado.limites;
        const [x, y] = estado.poseReal;
        const minX = Math.min(l.minX, x), maxX = Math.max(l.maxX, x);
        const minY = Math.min(l.minY, y), maxY = Math.max(l.maxY, y);

        const margem = 0.5;
        const larguraMundo = Math.max(maxX - minX + 2 * margem, VISTA_MINIMA);
        const alturaMundo = Math.max(maxY - minY + 2 * margem, VISTA_MINIMA * canvas.height / canvas.width);
        const escala = Math.min(canvas.width / larguraMundo, canvas.height / alturaMundo);
        return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, escala };
    }

    // A vista se aproxima do alvo aos poucos, sem saltos de zoom
    function suavizarVista(dtRelogio) {
        const alvo = vistaAlvo();
        if (!vista) {
            vista = alvo;
            return;
        }
        const f = 1 - Math.exp(-dtRelogio * 6);
        vista.cx += (alvo.cx - vista.cx) * f;
        vista.cy += (alvo.cy - vista.cy) * f;
        vista.escala += (alvo.escala - vista.escala) * f;
    }

    function aplicarVista() {
        // x_tela = centro + (x - cx)·escala ;  y_tela = centro - (y - cy)·escala
        ctx.setTransform(
            vista.escala, 0, 0, -vista.escala,
            canvas.width / 2 - vista.cx * vista.escala,
            canvas.height / 2 + vista.cy * vista.escala,
        );
    }

    function desenharGrade() {
        const metadeL = canvas.width / 2 / vista.escala;
        const metadeA = canvas.height / 2 / vista.escala;
        const passo = metadeL * 2 > 8 ? 1 : 0.5;

        ctx.lineWidth = 1 / vista.escala;
        ctx.strokeStyle = "#e8e8e8";
        ctx.beginPath();
        for (let x = Math.floor((vista.cx - metadeL) / passo) * passo; x <= vista.cx + metadeL; x += passo) {
            ctx.moveTo(x, vista.cy - metadeA); ctx.lineTo(x, vista.cy + metadeA);
        }
        for (let y = Math.floor((vista.cy - metadeA) / passo) * passo; y <= vista.cy + metadeA; y += passo) {
            ctx.moveTo(vista.cx - metadeL, y); ctx.lineTo(vista.cx + metadeL, y);
        }
        ctx.stroke();

        // Eixos na origem
        ctx.strokeStyle = "#bbb";
        ctx.beginPath();
        ctx.moveTo(vista.cx - metadeL, 0); ctx.lineTo(vista.cx + metadeL, 0);
        ctx.moveTo(0, vista.cy - metadeA); ctx.lineTo(0, vista.cy + metadeA);
        ctx.stroke();
        return passo;
    }

    // O rastro termina na pose interpolada, para acompanhar o robô sem degraus
    function desenharRastro(rastro, poseAtual, cor, tracejado) {
        ctx.strokeStyle = cor;
        ctx.lineWidth = 2 / vista.escala;
        ctx.setLineDash(tracejado ? [6 / vista.escala, 4 / vista.escala] : []);
        ctx.beginPath();
        rastro.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.lineTo(poseAtual[0], poseAtual[1]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Mesmo visual do robô original: corpo em meia-lua (frente arredondada)
    // e rodas laterais, em escala real com os parâmetros do painel.
    function desenharRobo(pose, fantasma) {
        const p = window.ParametrosRobo.obterParametros();
        const L = p.distancia_rodas;
        const D = p.diametro_roda;
        const s = L * 0.85;              // largura do corpo (entre as rodas)
        const larguraRoda = Math.max(D * 0.25, 0.015);

        ctx.save();
        ctx.translate(pose[0], pose[1]);
        ctx.rotate(pose[2]);
        ctx.lineWidth = 2 / vista.escala;

        // Corpo: traseira reta e frente em semicírculo (x = frente, y = esquerda)
        ctx.beginPath();
        ctx.moveTo(-s / 2, s / 2);
        ctx.lineTo(0, s / 2);
        ctx.arc(0, 0, s / 2, Math.PI / 2, -Math.PI / 2, true);
        ctx.lineTo(-s / 2, -s / 2);
        ctx.closePath();
        if (fantasma) {
            ctx.setLineDash([4 / vista.escala, 3 / vista.escala]);
            ctx.strokeStyle = "#d9534f";
            ctx.stroke();
            ctx.setLineDash([]);
        } else {
            ctx.fillStyle = "#2878b5";
            ctx.strokeStyle = "#17476b";
            ctx.fill();
            ctx.stroke();

            // Rodas
            ctx.fillStyle = "#333";
            ctx.strokeStyle = "#111";
            [L / 2, -L / 2].forEach((y) => {
                ctx.fillRect(-D / 2, y - larguraRoda / 2, D, larguraRoda);
                ctx.strokeRect(-D / 2, y - larguraRoda / 2, D, larguraRoda);
            });
        }
        ctx.restore();
    }

    function desenhar(dtRelogio) {
        ajustarResolucao();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        suavizarVista(dtRelogio);
        aplicarVista();
        const passo = desenharGrade();
        desenharRastro(estado.rastroOdometria, estado.poseOdometria, "#d9534f", true);
        desenharRastro(estado.rastroReal, estado.poseReal, "#2878b5", false);
        desenharRobo(estado.poseOdometria, true);
        desenharRobo(estado.poseReal, false);

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#888";
        ctx.font = `${12 * (window.devicePixelRatio || 1)}px Arial`;
        ctx.fillText(`grade: ${passo} m`, 8, canvas.height - 8);
    }

    reiniciar();
    cicloProdutor();
    requestAnimationFrame(quadro);
})();
