/* Painel de parâmetros e simulação do robô.
 *
 * Expõe window.ParametrosRobo com:
 *   obterParametros()  -> objeto com os parâmetros do formulário
 *   obterModelo()      -> chave do modelo escolhido
 *   simular()          -> Promise com o resultado de POST /api/robo/simular
 *   aoSimular(fn)      -> registra callback chamado com cada resultado
 * para que outras partes do projeto possam reutilizar o painel.
 */

const modoRodas = document.getElementById("pr-modo-rodas");
const camposRobo = document.getElementById("pr-campos-robo");
const camposRodas = document.getElementById("pr-campos-rodas");

(function () {
    "use strict";

    const API = "/api/robo";
    const CAMPOS = ["diametro_roda", "distancia_rodas", "erro_raio_percentual",
                    "velocidade_max_roda", "passo_tempo"];

    const form = document.getElementById("pr-form");
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


modoRodas.addEventListener("change", () => {
    camposRobo.hidden = modoRodas.checked;
    camposRodas.hidden = !modoRodas.checked;

    // Limpa somente o histórico dos gráficos
    historicoGraficos[0] = [];
    historicoGraficos[1] = [];

    atualizarTitulosGraficos();
    atualizarVelocidadesCalculadas();
    desenharGraficos();
});

function atualizarVelocidadesCalculadas() {
    const modoRodas = document.getElementById("pr-modo-rodas").checked;

    const raio = Number(
        document.querySelector('[name="diametro_roda"]').value
    ) / 2;

    const distancia = Number(
        document.querySelector('[name="distancia_rodas"]').value
    );

    let v, w, omegaE, omegaD;

    if (raio <= 0 || distancia <= 0) return;

    if (modoRodas) {
        // Entradas: velocidades das rodas
        omegaE = Number(
            document.getElementById("pr-velocidade-roda-esquerda").value
        );

        omegaD = Number(
            document.getElementById("pr-velocidade-roda-direita").value
        );

        // Calcula as velocidades do robô
        v = raio * (omegaD + omegaE) / 2;
        w = raio * (omegaD - omegaE) / distancia;

        document.getElementById("pr-label-linear").textContent = v.toFixed(2);
        document.getElementById("pr-label-angular").textContent = w.toFixed(2);

    } else {
        // Entradas: velocidades do robô
        v = Number(
            document.getElementById("pr-velocidade-linear").value
        );

        w = Number(
            document.getElementById("pr-velocidade-angular").value
        );

        // Calcula as velocidades das rodas
        omegaE = (v - w * distancia / 2) / raio;
        omegaD = (v + w * distancia / 2) / raio;

        document.getElementById("pr-label-roda-esquerda").textContent =
            omegaE.toFixed(2);

        document.getElementById("pr-label-roda-direita").textContent =
            omegaD.toFixed(2);
    }
}

// Atualiza os valores calculados ao alterar qualquer entrada
[
    "pr-velocidade-linear",
    "pr-velocidade-angular",
    "pr-velocidade-roda-esquerda",
    "pr-velocidade-roda-direita"
].forEach((id) => {
    document.getElementById(id).addEventListener(
        "input",
        atualizarVelocidadesCalculadas
    );
});

// Atualiza ao mudar os parâmetros geométricos
[
    "diametro_roda",
    "distancia_rodas"
].forEach((nome) => {
    document.querySelector(`[name="${nome}"]`).addEventListener(
        "input",
        atualizarVelocidadesCalculadas
    );
});

// Aplica as velocidades
document.getElementById("pr-aplicar-velocidades")
    .addEventListener("click", () => {

        let v;
        let w;

        if (modoRodas.checked) {
            // Velocidades angulares das rodas (rad/s)
            const omegaE = Number(
                document.getElementById(
                    "pr-velocidade-roda-esquerda"
                ).value
            );

            const omegaD = Number(
                document.getElementById(
                    "pr-velocidade-roda-direita"
                ).value
            );

            // Parâmetros geométricos do robô
            const diametro = Number(
                document.querySelector(
                    '[name="diametro_roda"]'
                ).value
            );

            const distancia = Number(
                document.querySelector(
                    '[name="distancia_rodas"]'
                ).value
            );

            const raio = diametro / 2;

            // Cinemática diferencial
            v = raio * (omegaD + omegaE) / 2;
            w = raio * (omegaD - omegaE) / distancia;

        } else {
            // Controle direto do robô
            v = Number(
                document.getElementById(
                    "pr-velocidade-linear"
                ).value
            );

            w = Number(
                document.getElementById(
                    "pr-velocidade-angular"
                ).value
            );
        }

        window.dispatchEvent(
            new CustomEvent("atualizarVelocidadesRobo", {
                detail: { v: v, w: w }
            })
        );
    });


const canvasGrafico1 = document.getElementById("pr-grafico-1");
const canvasGrafico2 = document.getElementById("pr-grafico-2");

const ctxGrafico1 = canvasGrafico1.getContext("2d");
const ctxGrafico2 = canvasGrafico2.getContext("2d");

// Histórico das duas variáveis exibidas
const historicoGraficos = [[], []];

const intervaloGrafico = 0.1; // 100 ms
const maxPontosGrafico = 120; // 12 segundos de histórico

function atualizarTitulosGraficos() {
    const titulo1 = document.getElementById("pr-titulo-grafico-1");
    const titulo2 = document.getElementById("pr-titulo-grafico-2");

    if (modoRodas.checked) {
        titulo1.textContent = "Velocidade linear do robô v (m/s)";
        titulo2.textContent = "Velocidade angular do robô ω (rad/s)";
    } else {
        titulo1.textContent = "Velocidade angular da roda esquerda ωE (rad/s)";
        titulo2.textContent = "Velocidade angular da roda direita ωD (rad/s)";
    }
}


function desenharGrafico(ctx, canvas, valores) {
    const largura = canvas.width;
    const altura = canvas.height;

    const margemEsquerda = 48;
    const margemDireita = 12;
    const margemSuperior = 15;
    const margemInferior = 28;

    const areaLargura = largura - margemEsquerda - margemDireita;
    const areaAltura = altura - margemSuperior - margemInferior;

    ctx.clearRect(0, 0, largura, altura);

    // Fundo
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, largura, altura);

    // Escala vertical simétrica para permitir valores negativos
    const maiorValor = Math.max(
        0.1,
        ...valores.map(valor => Math.abs(valor))
    ) * 1.1;

    const centroY = margemSuperior + areaAltura / 2;

    // Eixos
    ctx.strokeStyle = "#aaaaaa";
    ctx.lineWidth = 1;
    ctx.beginPath();

    ctx.moveTo(margemEsquerda, margemSuperior);
    ctx.lineTo(margemEsquerda, altura - margemInferior);

    ctx.moveTo(margemEsquerda, centroY);
    ctx.lineTo(largura - margemDireita, centroY);

    ctx.stroke();

    // Valores do eixo vertical
    ctx.fillStyle = "#333333";
    ctx.font = "11px Arial";
    ctx.textAlign = "right";

    ctx.fillText(
        maiorValor.toFixed(2),
        margemEsquerda - 5,
        margemSuperior + 5
    );

    ctx.fillText(
        "0",
        margemEsquerda - 5,
        centroY + 4
    );

    ctx.fillText(
        (-maiorValor).toFixed(2),
        margemEsquerda - 5,
        altura - margemInferior
    );

    // Eixo horizontal: tempo
    ctx.textAlign = "left";
    ctx.fillText("0 s", margemEsquerda, altura - 8);

    const tempoExibido = Math.max(
        0,
        (valores.length - 1) * intervaloGrafico
    );

    ctx.textAlign = "right";
    ctx.fillText(
        `${tempoExibido.toFixed(1)} s`,
        largura - margemDireita,
        altura - 8
    );

    // Curva de velocidade
    if (valores.length === 0) {
        return;
    }

    ctx.strokeStyle = "#1769aa";
    ctx.lineWidth = 2;
    ctx.beginPath();

    valores.forEach((valor, indice) => {
        const x = valores.length === 1
            ? margemEsquerda
            : margemEsquerda +
              (indice / (valores.length - 1)) * areaLargura;

        const y = centroY - (valor / maiorValor) * (areaAltura / 2);

        if (indice === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.stroke();
}

function desenharGraficos() {
    desenharGrafico(
        ctxGrafico1,
        canvasGrafico1,
        historicoGraficos[0]
    );

    desenharGrafico(
        ctxGrafico2,
        canvasGrafico2,
        historicoGraficos[1]
    );
}

function registrarPontoGraficos() {
    const valores = obterValoresGraficos();

    valores.forEach((valor, indice) => {
        const historico = historicoGraficos[indice];

        historico.push(Number.isFinite(valor) ? valor : 0);

        if (historico.length > maxPontosGrafico) {
            historico.shift();
        }
    });

    desenharGraficos();
}

window.addEventListener("atualizarGraficosRobo", (evento) => {

    const v = evento.detail.v;
    const w = evento.detail.w;

    const raio =
        Number(document.querySelector('[name="diametro_roda"]').value) / 2;

    const distancia =
        Number(document.querySelector('[name="distancia_rodas"]').value);

    if (raio <= 0 || distancia <= 0) {
        return;
    }

    let valor1;
    let valor2;

    if (modoRodas.checked) {

        // Usuário controla as rodas.
        // Os gráficos mostram as velocidades do robô.
        valor1 = v;
        valor2 = w;

    } else {

        // Usuário controla v e w.
        // Os gráficos mostram as velocidades das rodas.
        valor1 = (v - w * distancia / 2) / raio;
        valor2 = (v + w * distancia / 2) / raio;
    }

    historicoGraficos[0].push(valor1);
    historicoGraficos[1].push(valor2);

    if (historicoGraficos[0].length > maxPontosGrafico) {
        historicoGraficos[0].shift();
    }

    if (historicoGraficos[1].length > maxPontosGrafico) {
        historicoGraficos[1].shift();
    }

    desenharGraficos();
});

// Configuração inicial
atualizarTitulosGraficos();
desenharGraficos();
