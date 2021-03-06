# -*- coding: utf-8 -*-

# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

from __future__ import absolute_import, print_function, unicode_literals

import json
import os
import tarfile
from io import BytesIO

from taskgraph.util import docker
from taskgraph.util.taskcluster import (
    find_task_id,
    get_artifact_url,
    get_session,
)
from taskgraph.util.cached_tasks import cached_index_path
from . import GECKO


def load_image_by_name(image_name, tag=None):
    context_path = os.path.join(GECKO, 'taskcluster', 'docker', image_name)
    context_hash = docker.generate_context_hash(GECKO, context_path, image_name)

    index_path = cached_index_path(
        trust_domain='gecko',
        level=3,
        cache_type='docker-images.v1',
        cache_name=image_name,
        digest=context_hash,
    )
    task_id = find_task_id(index_path)

    return load_image_by_task_id(task_id, tag)


def load_image_by_task_id(task_id, tag=None):
    artifact_url = get_artifact_url(task_id, 'public/image.tar.zst')
    result = load_image(artifact_url, tag)
    print("Found docker image: {}:{}".format(result['image'], result['tag']))
    if tag:
        print("Re-tagged as: {}".format(tag))
    else:
        tag = '{}:{}'.format(result['image'], result['tag'])
    print("Try: docker run -ti --rm {} bash".format(tag))
    return True


def build_context(name, outputFile, args=None):
    """Build a context.tar for image with specified name.
    """
    if not name:
        raise ValueError('must provide a Docker image name')
    if not outputFile:
        raise ValueError('must provide a outputFile')

    image_dir = docker.image_path(name)
    if not os.path.isdir(image_dir):
        raise Exception('image directory does not exist: %s' % image_dir)

    docker.create_context_tar(GECKO, image_dir, outputFile, "", args)


def build_image(name, tag, args=None):
    """Build a Docker image of specified name.

    Output from image building process will be printed to stdout.
    """
    if not name:
        raise ValueError('must provide a Docker image name')

    image_dir = docker.image_path(name)
    if not os.path.isdir(image_dir):
        raise Exception('image directory does not exist: %s' % image_dir)

    tag = tag or docker.docker_image(name, by_tag=True)

    buf = BytesIO()
    docker.stream_context_tar(GECKO, image_dir, buf, '', args)
    docker.post_to_docker(buf.getvalue(), '/build', nocache=1, t=tag)

    print('Successfully built %s and tagged with %s' % (name, tag))

    if tag.endswith(':latest'):
        print('*' * 50)
        print('WARNING: no VERSION file found in image directory.')
        print('Image is not suitable for deploying/pushing.')
        print('Create an image suitable for deploying/pushing by creating')
        print('a VERSION file in the image directory.')
        print('*' * 50)


# The zstandard library doesn't expose a file-like interface for its
# decompressor, but an iterator. Support for a file-like interface is due in
# next release. In the meanwhile, we use this proxy class to turn the iterator
# into a file-like.
class IteratorReader(object):
    def __init__(self, iterator):
        self._iterator = iterator
        self._buf = b''

    def read(self, size):
        result = b''
        while len(result) < size:
            wanted = min(size - len(result), len(self._buf))
            if not self._buf:
                try:
                    self._buf = memoryview(next(self._iterator))
                except StopIteration:
                    break
            result += self._buf[:wanted].tobytes()
            self._buf = self._buf[wanted:]
        return result


def load_image(url, imageName=None, imageTag=None):
    """
    Load docker image from URL as imageName:tag, if no imageName or tag is given
    it will use whatever is inside the zstd compressed tarball.

    Returns an object with properties 'image', 'tag' and 'layer'.
    """
    import zstd

    # If imageName is given and we don't have an imageTag
    # we parse out the imageTag from imageName, or default it to 'latest'
    # if no imageName and no imageTag is given, 'repositories' won't be rewritten
    if imageName and not imageTag:
        if ':' in imageName:
            imageName, imageTag = imageName.split(':', 1)
        else:
            imageTag = 'latest'

    info = {}

    def download_and_modify_image():
        # This function downloads and edits the downloaded tar file on the fly.
        # It emits chunked buffers of the editted tar file, as a generator.
        print("Downloading from {}".format(url))
        # get_session() gets us a requests.Session set to retry several times.
        req = get_session().get(url, stream=True)
        req.raise_for_status()
        decompressed_reader = IteratorReader(zstd.ZstdDecompressor().read_from(req.raw))
        tarin = tarfile.open(
            mode='r|',
            fileobj=decompressed_reader,
            bufsize=zstd.DECOMPRESSION_RECOMMENDED_OUTPUT_SIZE)

        # Stream through each member of the downloaded tar file individually.
        for member in tarin:
            # Non-file members only need a tar header. Emit one.
            if not member.isfile():
                yield member.tobuf(tarfile.GNU_FORMAT)
                continue

            # Open stream reader for the member
            reader = tarin.extractfile(member)

            # If member is `repositories`, we parse and possibly rewrite the image tags
            if member.name == 'repositories':
                # Read and parse repositories
                repos = json.loads(reader.read())
                reader.close()

                # If there is more than one image or tag, we can't handle it here
                if len(repos.keys()) > 1:
                    raise Exception('file contains more than one image')
                info['image'] = image = repos.keys()[0]
                if len(repos[image].keys()) > 1:
                    raise Exception('file contains more than one tag')
                info['tag'] = tag = repos[image].keys()[0]
                info['layer'] = layer = repos[image][tag]

                # Rewrite the repositories file
                data = json.dumps({imageName or image: {imageTag or tag: layer}})
                reader = BytesIO(data)
                member.size = len(data)

            # Emit the tar header for this member.
            yield member.tobuf(tarfile.GNU_FORMAT)
            # Then emit its content.
            remaining = member.size
            while remaining:
                length = min(remaining, zstd.DECOMPRESSION_RECOMMENDED_OUTPUT_SIZE)
                buf = reader.read(length)
                remaining -= len(buf)
                yield buf
            # Pad to fill a 512 bytes block, per tar format.
            remainder = member.size % 512
            if remainder:
                yield '\0' * (512 - remainder)

            reader.close()

    docker.post_to_docker(download_and_modify_image(), '/images/load', quiet=0)

    # Check that we found a repositories file
    if not info.get('image') or not info.get('tag') or not info.get('layer'):
        raise Exception('No repositories file found!')

    return info
