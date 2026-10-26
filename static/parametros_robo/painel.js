/* Painel de parâmetros e simulação do robô.
 *
 * Expõe window.ParametrosRobo com:
 *   obterParametros()  -> objeto com os parâmetros do formulário
 *   obterModelo()      -> chave do modelo escolhido
 *   simular()          -> Promise com o resultado de POST /api/robo/simular
 *   aoSimular(fn)      -> registra callback chamado com cada resultado
 * para que outras partes do projeto possam reutilizar o painel.
 */
(function () {
    "use strict";

    const API = "/api/robo";
    const CAMPOS = ["diametro_roda", "distancia_rodas", "erro_raio_percentual",
                    "velocidade_max_roda", "passo_tempo"];

    const form = document.getElementById("pr-form");
    const canvas = document.getElementById("pr-canvas");
    const ctx = canvas.getContext("2d");
    const seletorModelo = document.getElementById("pr-modelo");
    const seletorTrajetoria = document.getElementById("pr-trajetoria");
    const blocoSegmentos = document.getElementById("pr-segmentos");
    const corpoTabela = blocoSegmentos.querySelector("tbody");
    const ouvintes = [];
    let modelos = [];
    let animacao = null;

    // ------------------------------------------------------------------ //
    // Leitura do formulário
    // ------------------------------------------------------------------ //
    function obterParametros() {
        const p = {};
        CAMPOS.forEach((c) => { p[c] = parseFloat(form.elements[c].value); });
        return p;
    }

    function obterModelo() {
        return seletorModelo.value;
    }

    function obterSegmentos() {
        return Array.from(corpoTabela.rows).map((linha) => {
            const [v, w, duracao] = Array.from(linha.querySelectorAll("input"))
                .map((i) => parseFloat(i.value) || 0);
            return { v, w, duracao };
        });
    }

    function corpoRequisicao() {
        const corpo = { parametros: obterParametros(), modelo: obterModelo() };
        if (seletorTrajetoria.value === "personalizada") {
            corpo.segmentos = obterSegmentos();
        } else {
            corpo.trajetoria = seletorTrajetoria.value;
        }
        return corpo;
    }

    // ------------------------------------------------------------------ //
    // Interface
    // ------------------------------------------------------------------ //
    function atualizarInfoRaios() {
        const p = obterParametros();
        const r = p.diametro_roda / 2;
        const rd = r * (1 + p.erro_raio_percentual / 200);
        const re = r * (1 - p.erro_raio_percentual / 200);
        document.getElementById("pr-erro-valor").textContent = p.erro_raio_percentual.toFixed(1);
        document.getElementById("pr-raios").textContent =
            `r nominal = ${(r * 1000).toFixed(2)} mm | ` +
            `r direita = ${(rd * 1000).toFixed(2)} mm | r esquerda = ${(re * 1000).toFixed(2)} mm`;
    }

    function atualizarDescricaoModelo() {
        const m = modelos.find((x) => x.chave === obterModelo());
        document.getElementById("pr-modelo-descricao").textContent = m ? m.descricao : "";
    }

    function adicionarSegmento(v = 0.3, w = 0, duracao = 2) {
        const linha = corpoTabela.insertRow();
        [v, w, duracao].forEach((valor) => {
            linha.insertCell().innerHTML = `<input type="number" step="0.01" value="${valor}">`;
        });
        const botao = document.createElement("button");
        botao.type = "button";
        botao.textContent = "✕";
        botao.onclick = () => linha.remove();
        linha.insertCell().appendChild(botao);
    }

    // ------------------------------------------------------------------ //
    // Desenho
    // ------------------------------------------------------------------ //
    function limites(amostras) {
        let xs = [], ys = [];
        amostras.forEach((a) => { xs.push(a.real[0], a.odometria[0]); ys.push(a.real[1], a.odometria[1]); });
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const tamanho = Math.max(maxX - minX, maxY - minY, 0.5) * 1.2;
        return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, tamanho };
    }

    function criarTransformacao(lim) {
        const escala = canvas.width / lim.tamanho;
        return (x, y) => [
            canvas.width / 2 + (x - lim.cx) * escala,
            canvas.height / 2 - (y - lim.cy) * escala,  // eixo y para cima
        ];
    }

    function desenharGrade(lim, paraTela) {
        ctx.strokeStyle = "#eee";
        ctx.lineWidth = 1;
        const passo = lim.tamanho > 6 ? 1 : 0.5;
        const ini = (v) => Math.floor((v - lim.tamanho / 2) / passo) * passo;
        for (let g = ini(lim.cx); g <= lim.cx + lim.tamanho / 2; g += passo) {
            const [px] = paraTela(g, 0);
            ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, canvas.height); ctx.stroke();
        }
        for (let g = ini(lim.cy); g <= lim.cy + lim.tamanho / 2; g += passo) {
            const [, py] = paraTela(0, g);
            ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(canvas.width, py); ctx.stroke();
        }
        ctx.fillStyle = "#888";
        ctx.font = "11px Arial";
        ctx.fillText(`grade: ${passo} m`, 6, canvas.height - 6);
    }

    function desenharCaminho(amostras, chave, ate, cor, tracejado, paraTela) {
        ctx.strokeStyle = cor;
        ctx.lineWidth = 2;
        ctx.setLineDash(tracejado ? [6, 4] : []);
        ctx.beginPath();
        for (let i = 0; i <= ate; i++) {
            const [px, py] = paraTela(amostras[i][chave][0], amostras[i][chave][1]);
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }

    function desenharRobo(pose, parametros, paraTela, escala, cor) {
        const [px, py] = paraTela(pose[0], pose[1]);
        const L = parametros.distancia_rodas * escala;
        const D = parametros.diametro_roda * escala;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(-pose[2]);
        ctx.fillStyle = cor;
        ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.arc(0, 0, L / 2 * 1.1, 0, 2 * Math.PI); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#333";
        ctx.fillRect(-D / 2, -L / 2 - D * 0.15, D, D * 0.3);  // roda esquerda
        ctx.fillRect(-D / 2, L / 2 - D * 0.15, D, D * 0.3);   // roda direita
        ctx.strokeStyle = "#000";
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L / 2 * 1.4, 0); ctx.stroke();  // frente
        ctx.restore();
    }

    function desenhar(resultado, ate) {
        const { amostras, parametros } = resultado;
        const lim = limites(amostras);
        const paraTela = criarTransformacao(lim);
        const escala = canvas.width / lim.tamanho;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        desenharGrade(lim, paraTela);
        desenharCaminho(amostras, "odometria", ate, "#d9534f", true, paraTela);
        desenharCaminho(amostras, "real", ate, "#2878b5", false, paraTela);
        desenharRobo(amostras[ate].odometria, parametros, paraTela, escala, "#f2b8b6");
        desenharRobo(amostras[ate].real, parametros, paraTela, escala, "#2878b5");
    }

    function animar(resultado) {
        cancelAnimationFrame(animacao);
        const total = resultado.amostras.length;
        const passo = Math.max(1, Math.round(total / 240));  // ~4 s a 60 fps
        let i = 0;
        const quadro = () => {
            i = Math.min(i + passo, total - 1);
            desenhar(resultado, i);
            if (i < total - 1) animacao = requestAnimationFrame(quadro);
        };
        quadro();
    }

    function mostrarErro(resultado) {
        const e = resultado.erro_final;
        const t = resultado.amostras[resultado.amostras.length - 1].t;
        document.getElementById("pr-erro-final").textContent =
            `t = ${t.toFixed(2)} s | erro de posição real × odometria: ${(e.posicao * 100).toFixed(2)} cm | ` +
            `erro de orientação: ${(e.orientacao * 180 / Math.PI).toFixed(2)}°`;
    }

    // ------------------------------------------------------------------ //
    // API
    // ------------------------------------------------------------------ //
    async function simular() {
        const resposta = await fetch(`${API}/simular`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(corpoRequisicao()),
        });
        const resultado = await resposta.json();
        if (!resposta.ok) throw new Error(resultado.erro || "Falha na simulação");
        ouvintes.forEach((fn) => fn(resultado));
        return resultado;
    }

    async function carregarModelos() {
        modelos = await (await fetch(`${API}/modelos`)).json();
        seletorModelo.innerHTML = modelos
            .map((m) => `<option value="${m.chave}">${m.nome}</option>`).join("");
        atualizarDescricaoModelo();
    }

    // ------------------------------------------------------------------ //
    // Eventos
    // ------------------------------------------------------------------ //
    form.addEventListener("input", atualizarInfoRaios);
    seletorModelo.addEventListener("change", atualizarDescricaoModelo);
    seletorTrajetoria.addEventListener("change", () => {
        blocoSegmentos.hidden = seletorTrajetoria.value !== "personalizada";
    });
    document.getElementById("pr-add-segmento").addEventListener("click", () => adicionarSegmento());
    form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const saida = document.getElementById("pr-erro-final");
        saida.classList.remove("pr-erro");
        try {
            const resultado = await simular();
            animar(resultado);
            mostrarErro(resultado);
        } catch (erro) {
            saida.textContent = erro.message;
            saida.classList.add("pr-erro");
        }
    });

    adicionarSegmento(0.3, 0, 3);
    adicionarSegmento(0.2, 0.5, 4);
    atualizarInfoRaios();
    carregarModelos();

    window.ParametrosRobo = {
        obterParametros,
        obterModelo,
        simular,
        aoSimular: (fn) => ouvintes.push(fn),
    };
})();
