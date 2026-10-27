"""Blueprint Flask com a API de parâmetros e simulação do robô.

Para integrar ao app principal:

    from modulo_robo import robo_bp
    app.register_blueprint(robo_bp)

Rotas (prefixo /api/robo):
    GET  /parametros   -> parâmetros padrão
    GET  /modelos      -> modelos disponíveis
    GET  /trajetorias  -> trajetórias pré-definidas
    POST /simular      -> {parametros, modelo, segmentos | trajetoria}
    POST /passo        -> {parametros, modelo, pose_real, pose_odometria,
                           dt, v, w | w_d, w_e}  (um passo da simulação em tempo real)
"""

from flask import Blueprint, jsonify, request

from .modelos import listar_modelos
from .parametros import ParametrosRobo
from .simulador import Robo, TRAJETORIAS, trajetoria_padrao

robo_bp = Blueprint("robo", __name__, url_prefix="/api/robo")

MAX_AMOSTRAS = 50  # poses intermediárias devolvidas por /passo


@robo_bp.get("/parametros")
def parametros_padrao():
    return jsonify(ParametrosRobo().para_dict())


@robo_bp.get("/modelos")
def modelos():
    return jsonify(listar_modelos())


@robo_bp.get("/trajetorias")
def trajetorias():
    return jsonify({nome: trajetoria_padrao(nome) for nome in TRAJETORIAS})


@robo_bp.post("/simular")
def simular():
    dados = request.get_json(silent=True) or {}
    try:
        parametros = ParametrosRobo.de_dict(dados.get("parametros"))
        robo = Robo(parametros, modelo=dados.get("modelo", "diferencial"))
        segmentos = dados.get("segmentos") or trajetoria_padrao(dados.get("trajetoria", "quadrado"))
        return jsonify(robo.simular(segmentos))
    except (ValueError, KeyError, TypeError) as erro:
        return jsonify({"erro": str(erro)}), 400


@robo_bp.post("/passo")
def passo():
    """Avança a simulação em tempo real por dt segundos.

    O estado (poses) fica no cliente; o servidor apenas aplica o modelo
    escolhido, subdividindo dt no passo de tempo dos parâmetros.
    """
    dados = request.get_json(silent=True) or {}
    try:
        parametros = ParametrosRobo.de_dict(dados.get("parametros"))
        robo = Robo(parametros, modelo=dados.get("modelo", "diferencial"),
                    pose_inicial=[float(c) for c in dados.get("pose_real", (0, 0, 0))])
        robo.pose_odometria = tuple(float(c) for c in dados.get("pose_odometria", robo.pose_real))

        if "w_d" in dados and "w_e" in dados:
            w_d, w_e = float(dados["w_d"]), float(dados["w_e"])
        else:
            w_d, w_e = robo.velocidades_rodas(float(dados.get("v", 0)), float(dados.get("w", 0)))

        dt = float(dados.get("dt", parametros.passo_tempo))
        n = max(1, round(dt / parametros.passo_tempo))
        if n > 10_000:
            raise ValueError("dt muito grande em relação ao passo de tempo.")
        # Poses intermediárias (no máximo MAX_AMOSTRAS) para a animação interpolar
        intervalo = max(1, -(-n // MAX_AMOSTRAS))
        amostras = []
        for i in range(1, n + 1):
            robo.passo(w_d, w_e, dt / n)
            if i % intervalo == 0 or i == n:
                amostras.append(robo.estado())

        estado = robo.estado()
        estado.update(w_d=w_d, w_e=w_e, erro=robo.erro_odometria(), amostras=amostras)
        return jsonify(estado)
    except (ValueError, KeyError, TypeError) as erro:
        return jsonify({"erro": str(erro)}), 400
