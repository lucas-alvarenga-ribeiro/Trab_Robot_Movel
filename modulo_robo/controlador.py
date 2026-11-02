import math
from .modelos import normalizar_angulo


class ControladorPonto:
    """Controlador proporcional (P) para ir até um único ponto (x, y)."""

    def __init__(self, x_alvo, y_alvo, kv=1.0, kw=4.0, tol=0.05):
        self.x_alvo = float(x_alvo)
        self.y_alvo = float(y_alvo)
        self.kv = kv
        self.kw = kw
        self.tol = tol

    def calcular_comandos(self, pose, v_max=0.5):
        x, y, theta = pose
        dx = self.x_alvo - x
        dy = self.y_alvo - y
        distancia = math.hypot(dx, dy)

        if distancia < self.tol:
            return 0.0, 0.0

        theta_desejado = math.atan2(dy, dx)
        erro_heading = normalizar_angulo(theta_desejado - theta)

        if abs(erro_heading) > math.radians(45):
            v = 0.0
        else:
            v = min(v_max, self.kv * distancia)

        w = self.kw * erro_heading
        return v, w


class ControladorCaminho:
    """Controlador em malha fechada para seguimento de trajetória (waypoints)."""

    def __init__(self, caminho, kv=1.0, kw=4.0, tol_ponto=0.15, tol_final=0.05):
        """
        :param caminho: Lista de coordenadas [[x1, y1], [x2, y2], ...]
        :param tol_ponto: Tolerância para considerar que atingiu um waypoint intermediário (m)
        :param tol_final: Tolerância fina para parar no destino final (m)
        """
        self.caminho = [(float(x), float(y)) for x, y in caminho]
        self.kv = kv
        self.kw = kw
        self.tol_ponto = tol_ponto
        self.tol_final = tol_final
        self.indice_alvo = 0

    def calcular_comandos(self, pose, v_max=0.5):
        if not self.caminho or self.indice_alvo >= len(self.caminho):
            return 0.0, 0.0  # Fim do caminho

        x, y, theta = pose
        x_alvo, y_alvo = self.caminho[self.indice_alvo]

        dx = x_alvo - x
        dy = y_alvo - y
        distancia = math.hypot(dx, dy)

        eh_ultimo = (self.indice_alvo == len(self.caminho) - 1)
        tol = self.tol_final if eh_ultimo else self.tol_ponto

        # Se alcançou o waypoint atual, avança para o próximo ponto da lista
        if distancia < tol:
            if eh_ultimo:
                return 0.0, 0.0
            self.indice_alvo += 1
            return self.calcular_comandos(pose, v_max)

        theta_desejado = math.atan2(dy, dx)
        erro_heading = normalizar_angulo(theta_desejado - theta)

        if abs(erro_heading) > math.radians(45):
            v = 0.0
        else:
            v = min(v_max, self.kv * distancia)

        w = self.kw * erro_heading
        return v, w