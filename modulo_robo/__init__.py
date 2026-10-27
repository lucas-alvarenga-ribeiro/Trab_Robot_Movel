"""Módulo de parâmetros e modelos cinemáticos do robô móvel diferencial."""

from .modelos import MODELOS, ModeloCinematico, ModeloDiferencial, ModeloIncremental, obter_modelo
from .parametros import ParametrosRobo
from .simulador import Robo, trajetoria_padrao

try:  # o blueprint só é necessário quando o Flask está disponível
    from .rotas import robo_bp
except ImportError:  # pragma: no cover
    robo_bp = None
