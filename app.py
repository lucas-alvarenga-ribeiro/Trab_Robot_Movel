

from flask import Flask, render_template

from modulo_robo import robo_bp

app = Flask(__name__)
app.register_blueprint(robo_bp)

@app.route("/")
def inicio():
    return render_template("index.html")

if __name__ == "__main__":
    app.run(debug=True)
