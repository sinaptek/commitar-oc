import subprocess
from typing import Dict, Any, List, Optional

def _run_git(args: List[str]) -> Dict[str, Any]:
    """Helper interno para ejecutar comandos de Git de forma segura."""
    try:
        res = subprocess.run(
            ["git"] + args,
            capture_output=True,
            text=True,
            check=True
        )
        return {"success": True, "output": res.stdout.strip()}
    except subprocess.CalledProcessError as e:
        return {"success": False, "error": e.stderr.strip() or e.stdout.strip()}
    except FileNotFoundError:
        return {"success": False, "error": "Git no está instalado o no se encuentra en el PATH."}

def create_feature_branch(branch_name: str) -> Dict[str, Any]:
    """Crea y cambia a una nueva rama de Git."""
    return _run_git(["checkout", "-b", branch_name])

def get_status() -> Dict[str, Any]:
    """Obtiene el estado actual del repositorio de forma resumida."""
    return _run_git(["status", "--short"])

def commit_and_push(message: str, branch: Optional[str] = None) -> Dict[str, Any]:
    """Agrega cambios seguidos, realiza un commit y sube la rama."""
    add_res = _run_git(["add", "."])
    if not add_res["success"]:
        return add_res

    commit_res = _run_git(["commit", "-m", message])
    if not commit_res["success"]:
        return commit_res

    push_args = ["push"]
    if branch:
        push_args.extend(["-u", "origin", branch])
        
    return _run_git(push_args)