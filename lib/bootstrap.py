"""
[INPUT]: 依赖本机 WorkBuddy 安装、当前用户的 wbipc 与 SQLite 只读索引。
[OUTPUT]: 生成独立 web 设备的短期通道凭证及匿名设备摘要。
[POS]: lib 的本机验证适配器，不属于未来独立 App 的登录实现。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import uuid


def write_private(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.parent.is_symlink() or path.is_symlink():
        raise ValueError('凭证路径必须为真实文件目录')
    os.chmod(path.parent, 0o700)
    temp = path.parent / ('.' + uuid.uuid4().hex + '.tmp')
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    try:
        with os.fdopen(os.open(temp, flags, 0o600), 'w') as stream:
            json.dump(value, stream, ensure_ascii=False)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def connect_module(app):
    source = app / 'Contents/Resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/library/workbuddy_ipc/__init__.py'
    spec = importlib.util.spec_from_file_location('wbremote_installed_ipc', source,
                                                 submodule_search_locations=[str(source.parent)])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def request(pipe, method, path, body=None):
    params = {'method': method, 'path': path}
    if body is not None:
        params['body_b64'] = base64.b64encode(json.dumps(body).encode()).decode()
    result = pipe.invoke('http.fetch', params, timeout=15)
    payload = json.loads(base64.b64decode(result['body_b64']))
    if result['status'] != 200 or payload.get('code', 0) != 0:
        raise RuntimeError(f"WorkBuddy 请求失败 HTTP={result['status']} code={payload.get('code')}")
    return payload.get('data', payload)


def main():
    parser = argparse.ArgumentParser(description='仅对当前账号建立远程会话协议验证通道')
    parser.add_argument('--app', type=Path, default=Path('/Applications/WorkBuddy.app'))
    parser.add_argument('--private-dir', type=Path, required=True)
    parser.add_argument('--target', help='同账号下明确选择的目标设备 ID；缺省为本机')
    args = parser.parse_args()
    config = Path.home() / '.workbuddy'
    with sqlite3.connect((config / 'workbuddy.db').as_uri() + '?mode=ro', uri=True) as db:
        row = db.execute('SELECT user_id FROM sessions WHERE user_id IS NOT NULL LIMIT 1').fetchone()
    if not row:
        raise RuntimeError('本机没有可用于当前账号验证的会话索引')
    target = args.target or (config / 'device-id').read_text().strip()
    ipc = connect_module(args.app)
    with ipc.connect(client_id='wbremote-validation', client_kind='tool', client_version='0.1.0') as client:
        pipe = client.get_pipe('wb.request')
        devices = request(pipe, 'GET', '/console/as/conversation-sync/devices/online')
        available = devices.get('devices', [])
        selected = next((item for item in available if item.get('deviceId') == target), None)
        if not selected or selected.get('deviceType') != 'local':
            raise RuntimeError('目标不是当前账号可见的本地执行设备')
        device_id = str(uuid.uuid4())
        body = {'userId': row[0], 'deviceId': device_id, 'clientType': 'web',
                'deviceName': 'WorkBuddy Remote 验证客户端', 'useDefaultScopes': True,
                'scopes': ['executor:' + target], 'chSdkVersion': '2.3.1'}
        credentials = request(pipe, 'POST', '/edge-cloud/credentials', body)
        result = {'userId': row[0], 'deviceId': device_id, 'targetDeviceId': target,
                  'credentials': credentials}
        write_private(args.private_dir / 'channel.json', result)
        write_private(args.private_dir / 'devices.json', available)
        print(json.dumps({'ipcConnected': True, 'deviceCount': len(available),
                          'localDeviceCount': sum(d.get('deviceType') == 'local' for d in available),
                          'targetIsLocal': True, 'targetOnline': selected.get('onlineFlag'),
                          'targetRemoteEnabled': selected.get('remoteViewFlag'),
                          'credentialsStored': True}, ensure_ascii=False))


if __name__ == '__main__':
    main()
