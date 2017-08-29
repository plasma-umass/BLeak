from setuptools import setup

setup(name='bleak-proxy',
      version='0.1',
      description='MITM proxy for BLeak',
      url='http://github.com/jvilk/bleak',
      author='John Vilk',
      author_email='jvilk@cs.umass.edu',
      license='MIT',
      install_requires=[
          'websockets',
      ],
      zip_safe=False)