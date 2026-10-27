"""Blueprint Flask com a API de parâmetros e simulação do robô.

Para integrar ao app principal:

    from modulo_robo import robo_bp
    app.register_blueprint(robo_bp)

Rotas (prefixo /api/robo):
    GET  /parametros   -> parâmetros padrão
    GET  /modelos      -> modelos disponíveis
    GET  /trajetorias  -> trajetórias pré-definidas
    POST /simular      -> {parametros, modelo, segmentos | trajetoria}
"""

from flask import Blueprint, jsonify, request

from .modelos import listar_modelos
from .parametros import ParametrosRobo
from .simulador import Robo, TRAJETORIAS, trajetoria_padrao

robo_bp = Blueprint("robo", __name__, url_prefix="/api/robo")


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
