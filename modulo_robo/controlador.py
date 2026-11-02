import math
from .modelos import normalizar_angulo

class ControladorPonto:
    """Controlador proporcional (P) para ir até um único ponto (x, y)."""

    def __init__(self, x_alvo, y_alvo, kv=1.0, kw=4.0, tol=0.05):
        self.x_alvo = float(x_alvo)
        self.y_alvo = float(y_alvo)
        self.kv = kv        # Ganho proporcional de velocidade linear
        self.kw = kw        # Ganho proporcional de velocidade angular
        self.tol = tol      # Raio de aceitação do destino (em metros)

    def calcular_comandos(self, pose, v_max=0.5):
        """Recebe pose [x, y, theta] e retorna velocidades [v, w]."""
        x, y, theta = pose
        dx = self.x_alvo - x
        dy = self.y_alvo - y
        distancia = math.hypot(dx, dy)

        # Condição de parada: chegou ao destino
        if distancia < self.tol:
            return 0.0, 0.0

        # Erro de orientação em relação ao alvo
        theta_desejado = math.atan2(dy, dx)
        erro_heading = normalizar_angulo(theta_desejado - theta)

        # Se o robô estiver muito desalinhado (> 45°), gira no próprio eixo primeiro
        if abs(erro_heading) > math.radians(45):
            v = 0.0
        else:
            v = min(v_max, self.kv * distancia)

        w = self.kw * erro_heading
        return v, w