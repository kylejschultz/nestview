from services.docker_recreate import recreate_container_with_current_config


def _attrs() -> dict:
    old_id = "abcdef1234567890"
    return {
        "Id": old_id,
        "State": {"Running": True, "Paused": False},
        "Config": {
            "Hostname": old_id[:12],
            "User": "",
            "OpenStdin": False,
            "Tty": False,
            "ExposedPorts": {"8080/tcp": {}},
            "Env": ["APP_ENV=test"],
            "Volumes": {"/data": {}},
            "NetworkDisabled": False,
            "Cmd": ["run"],
            "Entrypoint": ["/init"],
            "WorkingDir": "/app",
            "Domainname": "",
            "Labels": {
                "com.docker.compose.image": "sha256:old",
                "custom": "keep",
                "org.opencontainers.image.version": "old",
            },
        },
        "HostConfig": {
            "Binds": ["/tmp/data:/data:rw"],
            "NetworkMode": "test-net",
            "RestartPolicy": {"Name": "unless-stopped", "MaximumRetryCount": 0},
            "Runtime": "runc",
            "StopTimeout": 5,
        },
        "NetworkSettings": {
            "Networks": {
                "test-net": {
                    "Aliases": ["app", old_id[:12], "app"],
                    "Links": None,
                },
            },
        },
    }


class FakeImage:
    id = "sha256:new"
    labels = {"org.opencontainers.image.version": "new"}


class FakeImages:
    def get(self, image_ref: str):
        assert image_ref == "example/app:latest"
        return FakeImage()


class FakeAPI:
    def __init__(self):
        self.created_kwargs = None

    def create_endpoint_config(self, **kwargs):
        return kwargs

    def create_networking_config(self, endpoints):
        return endpoints

    def create_container(self, **kwargs):
        self.created_kwargs = kwargs
        return {"Id": "docker-2"}


class FakeContainer:
    def __init__(self, name: str, attrs: dict | None = None, *, fail_start: bool = False):
        self.name = name
        self.id = attrs["Id"] if attrs else "docker-2"
        self.attrs = attrs or {}
        self.fail_start = fail_start
        self.calls: list[tuple] = []

    def reload(self):
        self.calls.append(("reload",))

    def stop(self, timeout: int):
        self.calls.append(("stop", timeout))

    def rename(self, name: str):
        self.calls.append(("rename", name))
        self.name = name

    def start(self):
        self.calls.append(("start",))
        if self.fail_start:
            raise RuntimeError("start failed")

    def pause(self):
        self.calls.append(("pause",))

    def unpause(self):
        self.calls.append(("unpause",))

    def remove(self, force: bool = False):
        self.calls.append(("remove", force))


class FakeContainers:
    def __init__(self, old: FakeContainer, new: FakeContainer):
        self.old = old
        self.new = new

    def get(self, docker_id: str):
        if docker_id == "docker-1":
            return self.old
        if docker_id == "docker-2":
            return self.new
        raise KeyError(docker_id)


class FakeClient:
    def __init__(self, old: FakeContainer, new: FakeContainer):
        self.images = FakeImages()
        self.api = FakeAPI()
        self.containers = FakeContainers(old, new)


def test_recreate_container_preserves_config_and_removes_old_container():
    old = FakeContainer("app", _attrs())
    new = FakeContainer("app")
    client = FakeClient(old, new)

    new_id = recreate_container_with_current_config(client, "docker-1", "example/app:latest")

    assert new_id == "docker-2"
    assert ("stop", 5) in old.calls
    assert any(call[0] == "rename" and call[1].startswith("app-old-") for call in old.calls)
    assert ("start",) in new.calls
    assert ("remove", True) in old.calls

    kwargs = client.api.created_kwargs
    assert kwargs["name"] == "app"
    assert kwargs["image"] == "example/app:latest"
    assert kwargs["environment"] == ["APP_ENV=test"]
    assert kwargs["volumes"] == ["/data"]
    assert kwargs["host_config"]["RestartPolicy"]["Name"] == "unless-stopped"
    assert kwargs["labels"]["custom"] == "keep"
    assert kwargs["labels"]["com.docker.compose.image"] == "sha256:new"
    assert kwargs["labels"]["org.opencontainers.image.version"] == "new"
    assert kwargs["networking_config"]["test-net"]["aliases"] == ["app"]


def test_recreate_container_rolls_back_old_container_when_new_start_fails():
    old = FakeContainer("app", _attrs())
    new = FakeContainer("app", fail_start=True)
    client = FakeClient(old, new)

    try:
        recreate_container_with_current_config(client, "docker-1", "example/app:latest")
    except RuntimeError as exc:
        assert str(exc) == "start failed"
    else:
        raise AssertionError("expected RuntimeError")

    assert ("remove", True) in new.calls
    assert ("rename", "app") in old.calls
    assert ("start",) in old.calls
