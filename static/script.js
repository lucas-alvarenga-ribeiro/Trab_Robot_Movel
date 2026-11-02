/* Motor da simulação em tempo real (tela única). */
(function () {
    "use strict";

    const TRECHO_MIN = 0.1;
    const TRECHO_MAX = 1.0;
    const PERIODO_INFO = 0.1;
    const MAX_RASTRO = 20000;
    const DIST_RASTRO = 0.002;
    const VISTA_MINIMA = 3;

    const canvas = document.getElementById("pr-mundo");
    const ctx = canvas.getContext("2d");
    const botaoPausar = document.getElementById("pr-pausar");
    const seletorFator = document.getElementById("pr-fator");
    const saidaEstado = document.getElementById("pr-estado-tempo-real");
    const saidaTrajetoria = document.getElementById("pr-estado-trajetoria");

    let estado;
    let buffer;
    let comando = { v: 0, w: 0, rodas: null };
    let fila = [];
    let trajetoriaEmCurso = false;
    let pausado = false;
    let geracao = 0;
    let vista = null;
    let latencia = 0.1;

    const trecho = () => Math.min(TRECHO_MAX, Math.max(TRECHO_MIN, 2 * latencia));
    const antecedencia = () => trecho() + latencia + 0.1;
    const fator = () => Number(seletorFator.value);
    const ultima = () => buffer[buffer.length - 1];

    function amostra(t, real, odometria, cmd) {
        return { t, real: real.slice(), odometria: odometria.slice(), cmd };
    }

    // ------------------------------------------------------------------ //
    // Controle de Estado
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

    function cortarBuffer() {
        geracao++;
        buffer = [amostra(estado.t, estado.poseReal, estado.poseOdometria, comando)];
    }

    function definirPausa(valor) {
        pausado = valor;
        botaoPausar.textContent = pausado ? "▶ Continuar" : "⏸ Pausar";
    }

    // Evento 1: Controle Manual por Velocidades
    window.addEventListener("atualizarVelocidadesRobo", (evento) => {
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

    // Evento 2: Trajetórias do Formulário (Reta, Círculo, Quadrado)
    window.addEventListener("executarTrajetoriaRobo", (evento) => {
        reiniciar();
        fila = evento.detail.segmentos.map((s) => ({
            v: Number(s.v), w: Number(s.w), restante: Number(s.duracao),
        })).filter((s) => s.restante > 0);
        trajetoriaEmCurso = fila.length > 0;
        const total = fila.reduce((soma, s) => soma + s.restante, 0);
        saidaTrajetoria.textContent = `Executando trajetória (${total.toFixed(1)} s simulados)…`;
        definirPausa(false);
    });

    // Recebe e executa o caminho por waypoints enviado pelo painel
    window.addEventListener("executarAmostrasRobo", (evento) => {
        const amostrasRecebidas = evento.detail.amostras || [];
        if (amostrasRecebidas.length === 0) return;

        geracao++;
        fila = [];
        comando = { v: 0, w: 0, rodas: null };
        trajetoriaEmCurso = true;

        // Atualiza o buffer com as amostras calculadas pelo Python
        buffer = amostrasRecebidas.map((a) =>
            amostra(a.t, a.real, a.odometria, { v: 0, w: 0, rodas: null })
        );

        estado.t = 0;
        const tempoTotal = buffer[buffer.length - 1].t;
        saidaTrajetoria.textContent = `Navegando pelo caminho (${tempoTotal.toFixed(1)} s simulados)…`;
        definirPausa(false);
    });

    // Botões Físicos
    botaoPausar.addEventListener("click", () => definirPausa(!pausado));
    document.getElementById("pr-reiniciar").addEventListener("click", reiniciar);

    // ------------------------------------------------------------------ //
    // Produtor de Passos em Tempo Real (/api/robo/passo)
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
        if (!segmento && comandoNulo(cmd)) return false;

        let dt = trecho() * fator();
        if (segmento) dt = Math.min(dt, segmento.restante);

        let novas;
        if (comandoNulo(cmd)) {
            novas = [amostra(fim.t + dt, fim.real, fim.odometria, cmd)];
        } else {
            const minhaGeracao = geracao;
            novas = await pedirTrecho(fim, cmd, dt);
            if (minhaGeracao !== geracao) return true;
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
    // Animação e Renderização
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
    // Desenho no Canvas
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

        ctx.strokeStyle = "#bbb";
        ctx.beginPath();
        ctx.moveTo(vista.cx - metadeL, 0); ctx.lineTo(vista.cx + metadeL, 0);
        ctx.moveTo(0, vista.cy - metadeA); ctx.lineTo(0, vista.cy + metadeA);
        ctx.stroke();
        return passo;
    }

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

    function desenharRobo(pose, fantasma) {
        const p = window.ParametrosRobo.obterParametros();
        const L = p.distancia_rodas;
        const D = p.diametro_roda;
        const s = L * 0.85;
        const larguraRoda = Math.max(D * 0.25, 0.015);

        ctx.save();
        ctx.translate(pose[0], pose[1]);
        ctx.rotate(pose[2]);
        ctx.lineWidth = 2 / vista.escala;

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

    // ------------------------------------------------------------------ //
    // Evento de Clique no Canvas (Navegação Incremental por Ponto)
    // ------------------------------------------------------------------ //
    canvas.addEventListener("click", async (ev) => {
        const chkModoClique = document.getElementById("pr-modo-clique") || document.getElementById("chk-clique-alvo");
        
        if (!chkModoClique || !chkModoClique.checked) return;
        if (!vista) return;

        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        const px = (ev.clientX - rect.left) * dpr;
        const py = (ev.clientY - rect.top) * dpr;

        const xMundo = vista.cx + (px - canvas.width / 2) / vista.escala;
        const yMundo = vista.cy - (py - canvas.height / 2) / vista.escala;

        // Pega a última pose/tempo no fim do buffer para emendar sem dar saltos
        const ultimaAmostra = buffer[buffer.length - 1];
        const poseRealInicio = ultimaAmostra ? ultimaAmostra.real : estado.poseReal;
        const poseOdometriaInicio = ultimaAmostra ? ultimaAmostra.odometria : estado.poseOdometria;
        const tInicio = ultimaAmostra ? ultimaAmostra.t : estado.t;

        try {
            saidaTrajetoria.textContent = `Calculando trecho até X=${xMundo.toFixed(2)}m, Y=${yMundo.toFixed(2)}m…`;
            
            const resultado = await window.ParametrosRobo.simularPonto(
                xMundo, 
                yMundo, 
                poseRealInicio, 
                poseOdometriaInicio
            );

            const novasAmostras = resultado.amostras || [];
            if (novasAmostras.length > 0) {
                // Descarta a 1ª amostra (duplicada) e emenda o tempo no buffer
                const amostrasFormatadas = novasAmostras.slice(1).map((a) =>
                    amostra(tInicio + a.t, a.real, a.odometria, { v: 0, w: 0, rodas: null })
                );

                buffer.push(...amostrasFormatadas);
                trajetoriaEmCurso = true;
                definirPausa(false);
            }
        } catch (erro) {
            saidaTrajetoria.textContent = `Erro na navegação: ${erro.message}`;
            console.error(erro);
        }
    });

    reiniciar();
    cicloProdutor();
    requestAnimationFrame(quadro);
})();